# Station Portal

A station timeclock app built with **React + Vite + Tailwind CSS**. Clock in/out with
GPS location, review your history, check the shifts you're assigned to on the schedule
calendar, and manage users, roles, ranks, shifts, and system settings from the admin
module.

## Where the documentation lives

**App usage is documented in the app, not here.** Members have a **Help** module in the
sidebar; administrators have **Administration → System → Help**, with one guide per tab.
Both sets are markdown files in this repo:

```text
src/content/help/member/*.md    the Help module (everyone)
src/content/help/admin/*.md     Administration → System → Help
```

Adding a guide is adding a file — the first `# heading` becomes its title, and a numeric
filename prefix (`01-`, `02-`) sets the order. See [Help Guides](#help-guides) for the
authoring rules.

**This README covers the rest**: installing, building, the backend, deploying to GitHub
Pages, and the design notes and verification scripts a developer needs.

## Tech Stack

- React 19 + Vite (Oxc-powered)
- Tailwind CSS 4
- lucide-react icons
- Backend: Google Apps Script + Google Sheets (`src/services/Code.gs`, deployed separately)

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local env file and set the Apps Script URL:

   ```bash
   cp .env.example .env
   ```

   Then edit `.env`:

   ```
   VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

## Role Permissions

Access is driven entirely by columns on the **`roles` sheet**, one column per
permission. Every screen reads `src/utils/permissions.js`, which is the single list of
keys, labels and the Administration tab each one unlocks, and the column names are listed
in the publish checklist below.

**What each permission unlocks, in plain language, is documented in the app** —
*Administration → System → Help → Roles*. What follows here is how the rules are enforced.

- **`is_admin` is the master switch.** It grants every permission, so an administrator
  needs nothing else set. In the Roles editor the other boxes are shown ticked and
  locked, and saving forces them all TRUE so the sheet agrees with the UI.
- **Any single Administration permission opens the Administration module** — a role
  does not need `is_admin`. Its own tab appears and nothing else does (a role with only
  *Approve shift requests* sees just **Scheduling → Pending Approvals**).
- **Member modules are permissions too**: `can_view_my_schedule` gates My Schedule,
  `can_make_offers` the offer buttons, `can_view_full_schedule` the **Show everyone**
  toggle, `can_edit_own_availability` My Availability, and `can_use_timeclock` the
  Clock In/Out buttons and Clock History. Without the timeclock permission a member
  still sees the station clock and the *Currently on duty* card.
- **Reading documents is a permission: `can_view_documents`.** Without it the **Documents**
  module is not in the sidebar, the app will not stay on its tab, and every documents action
  on the server refuses. Which documents are *inside* the module is still the server's
  decision (published, live on today's date, at or above the member's rank), so the client
  does not filter again — a screen that repeated that rule would be a second copy of it.
- **`can_verify_documents` is a member permission on purpose.** Verifying is not an
  administrative act: an officer confirming a new member's truck checklist should not have to
  become an administrator, nor be able to edit the checklist. It opens the **Verify
  checklists** panel on the *Documents* tab in Administration (pick the checklist, then the
  member — the shape that answers "who is waiting on me") and the verification card in the
  member-facing module. The Documents tab is therefore the one tab **two** permissions open —
  see `roleAllowsTab` — and a role with only the verifying permission sees just that panel:
  no editor, no folders, no signature report.
- **Dependencies are enforced in the editor and on the server**: *Offer to fill open shifts*
  and *See the whole crew's schedule* are locked off while *View their schedule* is off
  (`can_make_offers` / `can_view_full_schedule` cannot be stored without
  `can_view_my_schedule`), and both document permissions that are more than reading —
  `can_manage_documents` and `can_verify_documents` — cannot be stored without
  `can_view_documents`, because managing or verifying documents you cannot see is not a thing.
  `hasDocumentPermission(ss, userId, permission)` is the server half of that rule, in one
  place, so a roles sheet edited by hand cannot produce a role that manages documents it
  cannot read.
- **Enforcement is server-side, not just in the UI.** Every admin action checks its own
  column through `hasRolePermission(ss, userId, 'can_...')` (which treats `is_admin` as
  granting everything), so hiding a button is a convenience rather than the control.
  `CLOCK_IN`/`CLOCK_OUT`, `SUBMIT_SHIFT_OFFER` and `SAVE_MY_AVAILABILITY` are gated the
  same way.
- **The Shifts tab is currently not wired up.** Editing the `shifts` sheet (shift
  definitions) is done in the spreadsheet, so the tab is hidden and needs no
  permission. The component is still at `src/components/admin/AdminShiftsTab.jsx`;
  restoring it means re-adding its `ADMIN_NAV_CATEGORIES` entry, its render block and its
  import in `AdminPanel.jsx`.
- **Help (System group) has no permission column either** — it is documentation in the repo,
  so it is open to anyone who can reach Administration. See the Help Guides section below;
  like User Settings, the member-facing **Help** module is open to everyone.
- **Debug (System group) is client-only.** `can_access_debug` opens a page that fires the app's
  own toasts, dialogs and sounds from buttons, and carries a slider for the level of every sound.
  The sliders are a **session-only sandbox**: they live in the engine's memory
  (`utils/uiSounds`), are never written to a sheet, and are reset on both ways a session ends
  (`handleLogout` and `endSession`) so the next person to sign in gets the shipped mix.
  Making a level permanent means editing `SOUND_VOLUME` in `utils/soundRules.js`. Nothing on the
  page calls an action, so it cannot change a row; the two dialogs that normally submit are
  previews whose buttons close instead. It needs no backend change, which is why it is the one
  tab whose permission works against a deployment that has not been re-published.
- **The Documents module is a three-part browser, and the reader owns the card.** Folders (with how many documents
  each holds, and how many are waiting on *this* member's signature) and the documents in the chosen folder — two
  columns using the whole card, with **no third track reserved** for a reader — and then **opening a document gives
  it the entire card at every width**: the two columns are not rendered at all while something is open
  (`{!openId && (`), and the back arrow in the card's header is the only way back. A reader that shared the card at
  one width and owned it at another was two answers to the same question. A filter — a search, or the **to sign**
  button — spans every folder, so its rows name theirs, and both are put away while reading, because a filter that
  changes a hidden list looks like a button that does nothing. The folder counts come from `folderSummaries` in
  `utils/documents` rather than from the component, because a folder showing "2" must contain the two documents the
  next column lists.
- **A verifier can read one member's records without impersonating them.** The **View as** box at the top of the
  member module (offered only with `can_verify_documents`) switches **the whole card** onto that member's records.
  That is `GET_MEMBER_DOCUMENT_RECORDS` — a thin, verifier-gated mirror of `GET_DOCUMENTS` that runs
  `memberDocumentRows(ss, thatMember, ranks)`, so the list and its badges are filtered by *their* rank, published
  state and dates, and `items_signed` is theirs. On the client one `recordUserId` / `recordDocuments` /
  `recordSignatures` triple drives the list, the folder counts, the "to sign" filter, the row states, the item
  ticks and the signature block, so the two modes cannot half-apply — which is exactly what went wrong first time:
  the reader switched but the list kept describing the verifier. It is still a **reader**, and strictly read-only:
  `canTickItems` is false, the tick handler refuses with the reason rather than silently, no signing is offered on
  another member's document, and the card says *Viewing X's records — read only*. Opening a document BODY still
  goes through `GET_DOCUMENT`, which answers to the caller's own rank — a verifier below a document's minimum rank
  can see that the member has a record against it without being able to open it, which is the honest answer and
  the server's to give.
- **"Verified" says who and when.** `checklistVerifiedLabel` in `utils/checklists` is the one wording, used by the
  member's own line and by a verifier reading somebody else's: *Verified by Jane Doe on Wed, Jul 1 2026 · 2:04 PM*,
  *Verified by 2 people on …* when more than one officer confirmed the same line, and simply *Verified* for a row
  written before verifications carried a verifier. Desktop prints it; a phone shows the word as a **button** that
  reveals the same text under the item, because the name and date would otherwise crowd out the item's own wording —
  the one place the two widths deliberately show different things rather than the same thing at different sizes.
- **Position is dragged, not typed.** There is no Order box: documents are draggable rows and folder headings are
  draggable blocks. The rule lives in two pure helpers — `reorderDocuments` and `reorderFolders` in
  `utils/documents` — which return the `{id, sort_order}` pairs to save, so "what does dropping A onto B mean" is
  testable; the component only sends what comes back. Two consequences worth knowing:
  - **A folder has no row of its own** (it is a name carried by its documents), so dragging a folder rewrites the
    order of the documents inside it, and a folder then sorts by its first document's `sort_order`. That is why
    `documentFolders` is no longer alphabetical, and why **Unfiled is pinned last** and cannot be dragged at all.
  - **A drag is not a save.** `ADMIN_REORDER_DOCUMENTS` writes one cell per row through `setSheetCellById` and never
    calls `upsertSheetRowById`, so `row_version` does not move and an administrator with a document open is not told
    somebody else changed it. Dropping a document onto a row in another folder is refused with a message rather than
    moving it, since position and membership are different fields. The editor also carries **Move up** / **Move
    down** for the open document: touch screens fire no drag events at all, and dragging must not be the only way.
- **A checklist is always signable, and signed only item by item.** `doc_type === 'checklist'` forces
  `is_sign_required` on (server-side, in `documentFieldsFrom`) and locks the box in the editor, so a checklist cannot
  be created that refuses its own checks; the flag now means *"its items are signable"*, never *"this document wants a
  signature"*. `SIGN_DOCUMENT` refuses a checklist outright — otherwise a meaningless document-level signature would
  clear the "to sign" badge while every item was still outstanding — and the item path deliberately does **not**
  consult the flag, because requiring it locked every checklist created before the rule out of being signed at all.
  A checklist therefore cannot advertise itself through a document signature: `documentItemSummaries` puts
  `item_count` / `items_signed` on the list rows, and `documentSignatureState` reads a checklist from those, so
  "3 to sign" means three items and a fully ticked checklist stops asking.
- **A checklist item's whole ROW is the control.** The report that started this was "clicking checklist items does
  nothing", and a 16px square that only its own pixels respond to is exactly that: the label swallowed the tap.
  The row is now a single `<button>` with the tick drawn as a `<span>` inside it — a button inside a button is
  invalid and would swallow the click — and a row that cannot be ticked (signed) is not a button at all.
- **A document can start on a date and retire on one, and retiring is not deleting.** `effective_date` and
  `end_date` are read through the *same* helper the schedule uses (`utils/effectiveDates`), with the same rule:
  a blank cell means no restriction, so every document written before these columns behaves exactly as it did.
  A retired document leaves every member's list and refuses a signature — `GET_DOCUMENT` reports it as missing and
  `SIGN_DOCUMENT` refuses it, which covers a page opened before the retirement — while the row, its items and every
  signature stay put, and administrators still see it marked **· retired**. `documentIsLiveOn` on the server and
  `documentLifecycle` on the client are the two halves; the server decides, the client labels.
- **A third document type, `link`, stores an address instead of a body.** Its `content` is validated to start with
  `http://` or `https://` — on the server, so it cannot be *stored*, and again on the client so the author hears
  before the request — which is what keeps a `javascript:` value out of an `href` in a table anybody can edit. The
  reader shows the address next to an **Open in a new tab** button (`target="_blank"` with `rel="noreferrer"`), and
  an unusable address is reported rather than offered. `documentLinkUrl` returns `''` for anything it will not
  follow, so no component builds an href from a raw cell.
- **A Tailwind arbitrary value is space-separated, not comma-separated.** A comma inside one still *builds* — into a
  `grid-template-columns` declaration with the comma left in it, which is invalid, so the browser drops the
  declaration and the layout falls back to one column with nothing to show for it. This exact mistake made the
  Documents browser stack its panes instead of sitting side by side; `verify:app-shell` now scans the sources for
  the shape of it, because the failure is otherwise silent.
- **Tailwind reads every file that is not ignored — comments and documentation included.** A class written in a
  comment or in this README is a class in the next build: while writing the note above, naming the broken utility
  kept generating it. Worth knowing both ways round — it means a stray example can ship CSS nobody asked for, and it
  is also why the note you are reading does not spell the broken value out.
- **Documents (Content group) store their text in the sheet, not in the app.** `can_manage_documents`
  opens the tab; members read the module with no permission, because the *server* decides what a
  member may see (published, and at or above their minimum rank) from the session's own rank — the
  screen renders what it is given rather than filtering again. Two rules keep it honest:
  **list reads never carry a body** (the list is metadata and a document is fetched one at a time, so
  opening the module costs the same on a shelf of a hundred as on a shelf of one), and **a signed
  document cannot be deleted** (unpublish it instead), so nothing can erase a signature by deleting
  what it was about. Unlike the Help guides, documents are rows in a sheet, so the module needs a
  connection. See `verify:documents`.
- **The editor is WYSIWYG without a WYSIWYG library.** Markdown stays the storage format, and the editing
  surface is generated from it, so there is no second dialect to drift from what a member reads. Three
  pieces hold that together: the parser records the **inline markdown each block was parsed from**
  (`inlineSource`, `itemSources`, table cell sources), which is what lets the editor render a block with
  the same `parseInline` the reader uses; `utils/richMarkdown` turns that model into editable HTML and
  back, with a `data-block` kind on every element so the reverse direction reads the kind rather than
  guessing from tags; and `utils/markdownStyles` holds the class tables **both** the reader and the editor
  render with, so a heading cannot look one way while writing and another while reading. The whole engine
  is pure — no DOM, no React — which is why `verify:rich-markdown` can drive it in node: it round-trips a
  document using every construct through HTML and back and compares the text, then covers what a *browser*
  does to that HTML (bare `<div>`s, `<p><br></p>`, pasted `<span>`s, a table it rewrote without a
  `<thead>`), then every toolbar command. Block commands change the model and re-render from it; inline
  ones wrap the selection, and the reader turns those tags back into markdown. The component is left with
  the parts no test here can reach: a `contenteditable` div, an 180ms commit, and the toolbar. **Write is
  the default**, with Markdown as the same document in text and Preview as the shared renderer.
- **A callout's label is drawn, not typed.** The box's name (*Warning*) comes from the kind, so it is
  emitted with `contenteditable="false"` and skipped by the reader — otherwise the first time an author
  clicked inside one, "Warning" would have become part of the procedure.
- **Signatures are add-only for members, and stamped from the session.** `SIGN_DOCUMENT` takes *both*
  identities (`user_id`, the member the row is about, and `signed_by_user_id`, who actually signed) and
  the date from the session, never from the payload — which is what makes "a member cannot sign
  somebody else's checklist" a fact rather than a convention. It **refuses** a removal rather than
  ignoring one, so a caller that asked to un-sign is told it cannot; removal is
  `ADMIN_REMOVE_DOCUMENT_SIGNATURE`, behind `can_manage_documents`, and goes to the system log. Each
  signature records the document's `content_revision`, so a report can say a signature predates the
  latest edit — a signature that appears to approve text nobody read being the one way this feature
  misleads.
- **Checklist items are their own records, and verification is somebody else.** An item lives in
  `document_checklist_items` so a signature can point at a stable id: editing an item's wording keeps
  its signatures, and **a signed item cannot be deleted** (the same rule as a signed document). Changing
  any item bumps the *parent document's* `content_revision`, so an edit under a signature reads as stale
  exactly as an edit to the text does. Signing takes a **list** of items in one request — ticking several
  lines and saving once is how the screen is used, and it gives the batch one timestamp, the same
  reasoning as the training module — while an item that is already signed or belongs elsewhere is
  *skipped and counted* rather than failing the whole batch.
- **A new checklist's items are staged in the component, and flushed the moment it is created.** An item
  cannot be written before the document it belongs to has an id, and requiring a save-then-reopen dance
  is what made the feature look missing. They are held in `stagedItems`, shown as *not saved*, and each
  one is then written through the ordinary item action — which counts what landed rather than assuming,
  because a checklist that arrives with nine of ten lines would be missing a line nobody thinks to sign.
- **Verification is a member permission, not an administrative one.** `can_verify_documents` opens the verification
  panel inside Documents and the **Verify checklists** panel on the Documents tab in Administration, because an
  officer confirming a new member's truck checklist is not an administrator. It is offered from two places on
  purpose: the member module answers it for the checklist you are reading, and the Administration panel answers
  "who is waiting on me" by listing the station's checklists and, for the chosen one, the members busiest first.
  Both call the same actions and the same pure helpers in `utils/checklists`, so they cannot disagree about what is
  outstanding. Three rules make a verification mean something: it **follows the member's own signature** (there is
  nothing to confirm about work nobody claimed), **nobody verifies their own checklist** (the server refuses it, and
  both panels leave you off the list by passing your own id in), and the verifier, the timestamp and the revision
  come from the session. `VERIFY_CHECKLIST_REMAINING` does a whole member in one call — 40 round trips against a
  script that takes seconds each would be worse than the wrong half-verified list it would leave behind — and it
  asks first, because a verification is a record that a check was made. `GET_DOCUMENT_SIGNATURES` carries the items
  alongside the signatures so its two audiences (document managers, and verifiers with no other access) can both
  name a row.
- **The verification panel says WHICH reason the queue is empty.** "Nothing is waiting to be verified" is true and
  useless: it reads as broken to somebody who has just watched a member tick boxes, and the panel now distinguishes
  four cases — the checklist has no items, nobody has signed, everything signed is *yours* (the server refuses
  self-verification, so it is filtered by design — the one that looks like a bug and is not), or everything signed is
  already verified. `verify:documents` also pins the wire format the queue depends on: the exact fields
  `SIGN_CHECKLIST_ITEM` writes, run through `membersAwaitingVerification`, because losing any one of them empties the
  card with no error anywhere.
- **`can_edit_notification_settings` without `is_admin`** can manage the station
  defaults but not the Firebase credentials: the FCM card is disabled, and the backend
  refuses those actions. That role may only write `notify_*` keys, so the permission
  cannot be used to change unrelated system settings.
- **A role with Administrator access can only be edited by an administrator**, and a
  non-administrator cannot grant Administrator access at all (otherwise a role with
  *Manage roles* could lift itself to full access, making every other permission moot).
  Both rules are enforced in `ADMIN_SAVE_ROLE` / `ADMIN_DELETE_ROLE`.
- **Reads are unchanged**: the member data endpoints still return a member's own data to
  any signed-in session, so a role that cannot open My Schedule does not lose the
  dashboard's clock status.
- **Permission columns are matched tolerantly.** The `roles` sheet is edited by hand, so
  a header differing from the key only in case, spacing or underscores still works
  (`Can_Edit_Users`, `can edit users`, `can_edit_users `). The backend does the same
  lookup, so the UI and the server cannot disagree on what a role may do.
- **User Settings → "Your Access" explains the outcome.** It lists what the role grants
  and, for a role that can reach Administration, reports any permission column the sheet
  is *missing* and any column that looks like a typo. A hand-edited sheet otherwise
  fails silently: an absent or misspelled column simply reads as "not granted", so the
  tab never appears and nothing explains why.

`npm run verify:permissions` exercises the rules directly, and
`npm run verify:admin-render` renders the gated screens headlessly once per role shape
(administrator, single-tab, member-only, nothing granted). `npm run verify:all` runs
every verifier in the project.

## Backend Deployment (Google Apps Script)

The backend (`src/services/Code.gs`) is tracked in this repository — it holds no
credentials, and the front end and back end are versioned together (see the note in
`.gitignore`). Committing it is not deploying it, though: when the backend changes you
must paste it into the Apps Script editor, save, and redeploy, or the station keeps
running the old script. The app keeps working as long as the URL in your env still
points at your latest deployment. The schedule calendar endpoints (`GET_SCHEDULE`,
`GET_ROSTER`) are part of that backend script, so redeploy the script after pulling
this change.

> **Deploy the backend BEFORE (or with) the client, not after.** Sign-in is two batched
> requests now — `GET_BOOTSTRAP` for a member, `ADMIN_GET_BOOTSTRAP` for an administrator —
> and a deployment that predates them answers `Invalid action`. The app says so in the
> console (`[refresh] this Apps Script deployment does not know GET_BOOTSTRAP…`) instead of
> showing an empty calendar and a 12-hour clock, but the fix is the redeploy: nine separate
> requests became one, which is what stops the tail of the old sign-in wave from timing out
> at 60 seconds. The individual actions are all still there, so an older *client* keeps
> working against the newer backend.

> **First-request redirect / CORS:** Apps Script answers the very first fetch to a
> deployment with a 302 redirect that browsers follow as a GET (no POST body). The
> backend's `doGet` returns `{"ok": true, "redirected": true}` via `ContentService`
> (which carries `Access-Control-Allow-Origin`) so that first request completes
> instead of failing with a CORS error. The API layer detects that marker and
> transparently re-sends the original action once. Read-only calls also retry once
> on a network/CORS failure, so the app still boots even if the backend hasn't been
> redeployed with `doGet` yet.

## Push Notifications (FCM)

Shift updates are delivered as push notifications through Firebase Cloud
Messaging: admins are told about new shift requests, and members are told when
their request is approved or declined.

- **Setup (once):** create the Firebase project, then paste the web config,
  VAPID public key and service-account credentials into
  **Administration → System → Notifications**. Full walkthrough:
  [`docs/FCM_SETUP.md`](docs/FCM_SETUP.md).
- **Per device:** each member presses **Enable** under
  **User Settings → Notifications**, once per device. Their switches default to the station defaults and
  can be overridden individually; leaving a setting blank inherits the station default.
  Turning a push off never hides the in-app announcement or notice — that separation is
  deliberate, and asserted. The member-facing detail is in the guides
  (*Help → User Settings*, and *Administration → System → Help → Notifications* for the
  station defaults).
- **Tokens are per device, in a `push_devices` sheet** (one row: id, user_id, token, device_label,
  updated_at), so a member's phone and computer both receive. The single `user_settings.fcm_token`
  column this replaced could only hold one token, which meant enabling a second device stopped the
  first from receiving — and "turn off" on a device that had never been enabled cleared the *other*
  device's token. The legacy column is still **read** (a device registered before this keeps working
  with no re-enable) and is cleared when its token is removed. The sheet is created on first use, so
  there is nothing to add by hand. `npm run verify:push-devices` covers the rules, including that
  turning one device off cannot disturb another.
- **Who receives a shift-offer push is decided by `can_approve_shifts`**, resolved
  server-side by `shiftApproverUserIds()`, so the switch a member sees and the delivery
  they get cannot disagree. The visibility rule for that switch lives in
  `src/utils/notificationPrefs.js` so it can be verified directly
  (`npm run verify:notification-prefs`).
- **Sending:** `notifyShiftOffer()` in `src/services/Code.gs` is the single seam
  where every shift-offer change becomes a message, so the backend has to be
  redeployed (`SAVE_FCM_TOKEN`-style writes go through the existing
  `UPDATE_USER_SETTINGS` action; `ADMIN_GET_PUSH_STATUS` and
  `ADMIN_SEND_TEST_PUSH` back the admin screen).
- **Authorizing (one time):** the FCM backend calls `UrlFetchApp`, which needs
  the `script.external_request` scope. If the script was authorized before that
  code existed, admin tests fail with *"You do not have permission to call
  UrlFetchApp.fetch"* — this is **not** a trigger problem. Run the
  `diagnoseFcmSetup` function once from the Apps Script editor and follow its
  output. If no consent prompt appears, either revoke the project's access at
  `myaccount.google.com/permissions` and re-run, or pin `oauthScopes` to
  `spreadsheets` + `script.external_request` in `appsscript.json` (the complete
  list for this script), then deploy a new version.
- **Service worker:** `public/sw.js` handles `push`/`notificationclick` and is
  built to `/sw.js`; it is registered from `src/main.jsx` at the deployed base
  path, and only ever asks for permission after a member clicks **Enable**.

## Refreshing After a Save

Every screen reads its data from React state that is loaded once and refreshed on demand, so
a save is only half the job: the app also has to reload the caches that screen renders from.
That contract lives in one place — `refreshAdminData` in `src/App.jsx`, which every admin
tab calls (as `onDataChanged` / `onAdminDataChanged`) after a successful write. It reloads
**all** the caches in one parallel wave:

| Refresher | Reloads |
|---|---|
| `fetchInitialData()` | roles, ranks, shifts, system & user settings |
| `refreshAdminUsers()` | the member directory |
| `refreshAdminScheduleData()` | schedule templates, assignments **and** offers |
| `refreshSchedule()` | the schedule rows (approving an offer fills one) |
| `refreshRoster()` | member names on the calendar |
| `refreshOnDuty()` | who is on duty |

Two rules keep this honest, and both are enforced by `npm run verify:refresh-wiring`:

- **Never refresh only half the data.** The function used to branch on whether it was handed
  a token: without one it reloaded roles/ranks/settings, with one it reloaded only
  users/templates/assignments/offers. A tab that called it token-less therefore saved an
  assignment — or a user, or a template — and kept rendering its own stale copy, with the
  sheet perfectly correct. That is why the token now defaults to the session's and both
  halves always load.
- **A tab that writes must ask for a refresh.** The audit derives the write functions from
  `src/services/api.js`, so a new tab that saves without telling the app fails the check.

Two deliberate exceptions: the **availability** sheet is refreshed by its own screen (it
already updates the shared state, so the schedule board's warnings stay current without
every save refetching a table that grows one row per member per shift), and
**Schedule Management** drives its own local copy — its sync effect is dirty-guarded, so a
background refetch can never discard unsaved edits.

The audit cannot prove a refresh *ran*; it proves the wiring is complete. Behavioral checks
live in the render harness (`npm run verify:admin-render`).

## Help Guides

Two sets of markdown guides, one per audience, with **one guide for every module and every tab**:

| Where | Folder | Guides |
|---|---|---|
| **Help** (sidebar module) | `src/content/help/member/` | One per member module, plus the hidden game |
| **Administration → System → Help** | `src/content/help/admin/` | One per Administration tab, plus an overview |

Adding a guide is adding a file. The first `# heading` becomes the title, a numeric filename
prefix (`01-`, `02-`) sets the order, and the sidebar lists every file in the folder. Both
folders are bundled at build time with `import.meta.glob(..., { query: '?raw', eager: true })`,
so guides work offline, need no fetch, no index file and no base-path handling on GitHub Pages
— a glob that matched nothing would fail silently, which is why `verify:help` asserts both
folders actually load.

`verify:help` also asserts **coverage**: every tab id in the permissions catalog has a matching
guide slug, and so does every member module. Adding a tab without documenting it fails the suite
rather than going unnoticed — which is what that check is for.

### Guide order

**The number is the order the thing appears in the app**, not the order the guides were written:

| Set | Order |
|---|---|
| `admin/` | The overview first, then the flattened `ADMIN_NAV_CATEGORIES` order — People, Scheduling, Timeclock, Content, System |
| `member/` | The overview first, then the sidebar order — Timeclock, Clock History, My Schedule, My Availability, Training, Documents, Help, User Settings |

So a `system-log` guide sits between the notifications and help guides, because that is where the tab
sits. The hidden game comes last in the member set, since it is not in the navigation at all.

`verify:help` asserts the numbering is **`01..N` with no gaps and no duplicates**. That is the
invariant a hand-renumbering breaks — inserting a guide as "14" when it belongs at 12 leaves the list
out of order, and a copy-paste that forgets to renumber leaves two of the same. Both are silent
otherwise. Renumbering means moving files, so it is worth re-running the suite afterwards.

### One line per paragraph — never hard-wrap

The guides are written with **no hard wrapping**: a paragraph is one line, and a list item is one
line, however long. `verify:help` enforces it. This is not tidiness for its own sake — wrapping
changes what renders, because the parser is line-based:

| Wrapped | What happens |
|---|---|
| A **list item** | The list ends at the break, so the rest of the sentence renders as a stray paragraph *outside* the list. 147 of these were in the shipped guides. |
| An **emphasis span** | Each half keeps an unpaired `*`, so `*Sign trainings*` renders as literal asterisks instead of italics. |

Fenced code and tables are exempt, and the check mirrors those rules rather than approximating them —
its first version passed on a wrapped bullet because the rule excluded list items from being
"prose", which is exactly the case it needed to catch.

`npm run fix:guides` is the fixer (`scripts/reflow-guides.py`): it reflows, collapses blank runs and
normalizes the file ending, leaving fenced code and alert markers alone. Run it when the lint fails.

### Markdown alerts

Guides can use **GitHub alerts** — `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`,
`> [!CAUTION]` — and all nine block quotes in the shipped guides now carry a type. The parser turns a
tagged quote into an `alert` block (`{ type: 'alert', kind, blocks }`) whose **body is re-parsed as
markdown**, so an alert holds paragraphs, lists, emphasis and code like any other block; a blank `>`
line separates its paragraphs.

`Markdown.jsx` renders it as a colored callout with the type's icon **and its name**, because color
alone is not a signal everyone receives.

Two deliberate refusals:

- **An unrecognized marker stays a quote.** `[!DANGER]` renders as visible `[!DANGER]` text rather
  than being styled as something it is not — a typo is seen, not guessed at. `verify:help` also fails
  on an unsupported type in a shipped guide, and on a marker with no body line under it (which would
  render an empty box).
- **A marker mid-quote is not an alert.** It has to open the first line, so a quote that merely
  mentions `[!NOTE]` stays a quote.

The reflow script keeps the marker on its own line — the form GitHub documents — and treats an alert
as a quote whose paragraphs it joins, so reflowing can never fold a marker into its body.

An **empty** guide file is still listed, and renders an explanation naming the file to edit instead
of a blank pane. The verifier reports empty guides as a note rather than a failure, since a
placeholder you have just created is legitimate, while a stale one is visible.

The markdown is parsed by `src/utils/markdown.js` into a **plain data tree** that
`src/components/Markdown.jsx` renders as React elements. There is no `dangerouslySetInnerHTML`
anywhere in the path, so HTML written inside a guide renders as literal text instead of being
executed. Supported syntax: headings, paragraphs, bold/italic, inline code, fenced code, links,
bullet and numbered lists, block quotes, `---` rules, tables, inline highlights (`==text==`) and
`***bold italic***`, which is what the document editor's toolbar writes when both are pressed on one
phrase.

Emphasis deliberately hugs its content, so `snake_case`, `2 * 3 * 4` and `* not italic *` stay
literal — the cases a guide author hits by accident, and column names appear in these guides
constantly. Not supported (and not needed): nested lists, images, setext headings and reference
links.

> The admin Help tab has **no permission column**. Gating documentation behind a permission
> would hide it from the people most likely to need it, and because it is listed after the
> permission-driven tabs it can never become the tab a role lands on by default. It is still
> closed to a role with no Administration access at all — see `ADMIN_PERMISSIONLESS_TABS` in
> `src/utils/permissions.js`.

## Users Tab: a Save Shows Immediately

Because `doPost` serializes requests behind a script lock, the refresh wave a save triggers takes
tens of seconds and cannot be waited on. The Users tab therefore merges the saved row into the list
straight away (`mergeSavedUser` in `src/utils/userRow.js`, which refuses to touch a row with no id,
never copies a password, and only writes the columns the editor owns) and shows *"Reloading the full
list in the background…"* while the authoritative refresh runs. Without that, re-opening the form
right after saving showed the **pre-save** values — the write had landed, but the list had not.

The same `await onDataChanged()` pattern still exists in the other admin tabs, so their saves wait
for the whole wave; they just do not add a second write, so it is less noticeable.

## Session idle timeout

`session_timeout` in `system_settings` holds a number of **minutes**. When it is usable, a member who
neither interacts with the app nor navigates within that window is signed out. Blank or unusable
leaves the previous behavior in place — a 12-hour session.

Implemented in **two halves on purpose**:

| Half | Where | What it does |
|---|---|---|
| Client | `src/utils/sessionTimeout.js` + an effect in `App.jsx` | A one-second tick that signs the user out visibly at the threshold, with a warning in the final minute |
| Server | `sessionTtlMs` / `parseSessionRecord` in `Code.gs` | The session's **sliding expiry** uses the same value, so an idle token stops working |

**The client timer is the courtesy; the server expiry is the rule.** A browser-only timeout is not a
timeout — it is a button that claims the session ended. The server half is what stops a token being
used afterwards, and `scripts/verify-session-timeout.mjs` asserts it by lifting the real
`parseSessionTimeoutMinutes`, `sessionTtlMs`, `parseSessionRecord`, `retuneSessions`,
`systemSettingsMap` and `getSheetData` out of `Code.gs` and running them against a stub sheet.

### The performance design: the request path does no settings I/O

The obvious implementation reads the setting on every authenticated request, softened with
`CacheService`. That costs a cache round trip on **every** request, and — worse — a cache eviction
costs a full `system_settings` **sheet read** on the auth path of somebody's save. Since `doPost`
serializes requests behind a script lock, that stall lands in everyone's queue.

So the window travels **in the session record** instead: `userId|expiry|ttlMs`. Refreshing a session
is then one property write and two `parseInt` calls. Measured by the verifier:

```text
sheet reads:        1   (the members lookup, pre-existing)
settings reads:     0   (was 1 per cache miss)
CacheService calls: 0   (was 1 per request, plus a sheet read on eviction)
script properties:  1 read + 1 write (was the same)
```

**The trade is change propagation, handled by pushing rather than polling.** `ADMIN_SAVE_SYSTEM_SETTING`
calls `retuneSessions(ss)` for this key, which re-expresses every live session against the new window
while **preserving elapsed idle time** — a session idle for 20 of 30 minutes becomes 20 of the new
window, so shortening the timeout applies at once without handing everyone a fresh full window. One
admin save pays a bounded cost proportional to live sessions; every other request pays nothing.

Editing the cell **directly in the spreadsheet** cannot trigger that, so it applies at the next
sign-in. That is the deliberate trade: the app's own card is the supported path.

A record written by an earlier deploy (two fields, absolute expiry only) still works — it falls back
to the default window rather than logging everybody out mid-shift on release.

Activity is a pointer, key, scroll or touch event, plus **navigating between modules** — which is
why `activeTab` is in the effect's dependency list: the effect re-arming *is* the navigation reset.
Returning to a background tab re-evaluates immediately rather than waiting for the next tick, so an
abandoned session ends as soon as the member looks at it again.

The client tick is a `Date.now()` comparison and two subtractions: measured at **0.01µs per tick**
(≈84,000 ticks/ms), and it skips the `setState` entirely when the value has not changed, so an idle
session does no React work at all.

`PING` exists solely so **Stay signed in** is honest: without it the button would reset a local timer
while the server session lapsed, and the next action would fail with a re-authentication prompt that
looked random.

### What this does NOT affect: push notifications

Notification delivery is independent of sessions, and deliberately so:

| Step | Authenticated by | Session involved? |
|---|---|---|
| `notifyShiftOffer` → `sendShiftOfferPush` → FCM | **Service account** (server-to-server) | No — recipients come from the sheets, via `shiftApproverUserIds(ss)` or the offer's `user_id` |
| FCM → push endpoint → `public/sw.js` | The push subscription + VAPID key | No — the worker runs with no tab, no app, no session |
| The device token | The member's `user_settings` row, keyed by **user id** | No |

**Signing out does not unregister a device.** `endSession` and `handleLogout` touch React state only —
no token clearing, no service-worker unregistration — so an idle sign-out never stops notifications.
`verify:admin-render` asserts precisely that, so a future "tidy up on logout" cannot quietly break
delivery.

Two consequences worth knowing:

- **Token registration does need a session** (`UPDATE_USER_SETTINGS` is session-guarded), which is
  inherent: you have to be signed in to enable a device.
- **The in-app toast is gated on being signed in.** The OS notification is per-device and still
  fires, but a toast rendered on the *login screen* would announce app activity to whoever is
  standing at the terminal — which is exactly the situation the idle timeout creates, since it can
  now leave a signed-out page open and visible. The push wording names no member ("A member offered
  to take an open shift (2026-03-14)"), so this was low severity, but it is the app announcing
  activity to an empty room.

**A known, deliberate mismatch:** the server window is refreshed by *requests*, while the client
timer is reset by *activity*. A member who interacts continuously for longer than the timeout without
causing a request — filling in a long form, say — can therefore have the server session lapse while
the client is still happily counting down. The reauthentication modal already covers this: it
prompts, then **replays the action that failed**, so the save goes through rather than being lost.
Closing that gap properly needs a keep-alive on activity, which would reintroduce exactly the
per-request traffic this design removes — so it is left open on purpose.

## Performance Notes

- **Batched backend writes**: `ADMIN_BULK_SAVE_SCHEDULE` reads the `schedule` sheet
  once, applies each row update with a single `setValues`, appends all new rows in
  one call, and removes deleted rows in a single bottom-up pass
  (`bulkUpsertSheetRowsById` / `bulkDeleteSheetRowsById`). Single-row saves write the
  whole row in one call instead of one `setValue` per column. This matters because
  each SpreadsheetApp read/write has real overhead — the sheet *looks* updated long
  before the script finishes.
- **Save responses return ids**: the bulk save returns the server-assigned `ids` for
  each submitted entry, so the Schedule Management tab applies them instantly and
  only refreshes the server copy in the background — the Save button stops spinning
  as soon as the write is confirmed.
- **Sign-in is interactive in two round trips, not four.** Each member-data fetch is a
  separate Apps Script execution (~1–3s). `handleLogin` used to await all of them — and
  then a second, admin-only wave — while the app was already rendered behind the "Please
  Wait" overlay. Now `loadPostLoginData` awaits only the two fetches the first screen
  shows (clock history and who is on duty) and starts the remaining four in the
  background, so the overlay clears as soon as the visible data is ready and each other
  tab fills in on its own.
- **No duplicated admin fetches.** Sign-in and the `authToken` effect both fetched the
  admin directory and schedule data, and the effect also fetched the offers table that
  `refreshAdminScheduleData` already fetches internally. For an admin that was 13 backend
  executions per sign-in; it is 9 now, with the redundant offers call removed.
- **No admin save waits on the refresh wave.** A save is one backend write; the refresh behind it is
  nine requests (`refreshAdminData`), and Apps Script serializes them behind a script lock in `doPost`,
  so awaiting the wave held the Save button spinning over a sheet that had already been written — the
  reason a save "takes a long time from the front end but lands on the sheet almost immediately". Every
  admin tab now starts the wave and stops waiting for it, and merges the row it just saved into app state
  itself (`utils/savedRow.js`, one applier for users, roles, ranks, assignments and templates) so the
  table is correct the moment the write returns. A tab whose `onDataChanged` is a *single* request
  (Clock Management, Member Availability) still awaits it, because one round trip is what removes the row
  the administrator just acted on. `verify:refresh-wiring` fails if any tab awaits the fan-out.
- **The script lock is taken for WRITES only.** `doPost` used to acquire a script lock before it even knew
  which action was asked for, and Apps Script runs a script's executions concurrently — so every request
  queued behind every other. With a ten-request refresh wave behind each save, that was the difference
  between a save settling in ~2s and in ~30s. Read-only actions now skip the lock, so a wave runs
  concurrently and finishes in about the time of its slowest request. The safety of that rests on one rule:
  an action listed in `READ_ONLY_ACTIONS` must contain **no write call at all**. `verify:refresh-wiring`
  reads each listed action's own body out of `Code.gs` and fails if it does, with a negative control against
  `LOGIN` (a known writer) so the detector itself can't rot.
- **Background reads announce themselves, without blocking anything.** A wave reports through a sonner toast
  keyed by an id that is never reused, so two waves running at once **stack** rather than replacing each
  other: `Refreshing views — 3 of 9 done…` counts up, then becomes `Refreshing views — up to date` (or
  `… — 1 could not be refreshed`) for 2.5s. The count is **derived from the request list**, never maintained
  by hand — a hard-coded total that fell out of step with the list is what left a toast stuck at
  "9 of 10 done…", because the wave could never reach a number that was wrong from the start. A failed or
  timed-out request still counts, so the wave always finishes and says what went wrong. The counting lives in
  `utils/activity.js` apart from the toast library, so it is tested directly (`verify:refresh-wiring` drives
  it with fake callbacks), and nothing awaits it — it is feedback, not a gate.
- **Parallel refreshes**: login, re-authentication, and post-save refreshes issue
  their data fetches concurrently (`Promise.all`) instead of chaining six or three
  sequential Apps Script executions, cutting those waits to roughly one round trip.

## Deploying to GitHub Pages

This repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that
builds the app and publishes it to GitHub Pages automatically.

1. **Create a repository** on GitHub and push this code to it.
2. **Add the Apps Script URL as a repository secret:**
   Settings → Secrets and variables → Actions → **New repository secret**
   - Name: `VITE_APPS_SCRIPT_URL`
   - Value: your Apps Script URL (the same one used locally in `.env`)
3. **Enable GitHub Pages with the Actions source:**
   Settings → Pages → **Source: GitHub Actions**
4. **Push to `main`** (or run the workflow manually under the Actions tab).

The app will be published at:

```
https://<your-username>.github.io/<repo-name>/
```

The workflow automatically sets the correct base path for your repository name, so
asset URLs resolve correctly no matter what you name the repo.

### Before you publish: the checklist

The front end and the backend deploy separately, so **the app can be published while the backend is behind it**. Work through this once; it is the difference between a working deployment and a screen full of "Invalid action type".

**1. Redeploy the Apps Script backend.** Paste the current `src/services/Code.gs` into the editor, Save, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. A deployment is pinned to a version, so editing the file is not enough. Everything added recently is server-side: events, announcements, training, documents and their checklist items and signatures, the session timeout, the System Log, the clock geofence, the write-only script lock, and the batched sign-in (`GET_BOOTSTRAP` / `ADMIN_GET_BOOTSTRAP` — see the warning above about deploying before the client). A deployment that predates the checklist work answers the new actions with "not available" and the app shows that message rather than failing silently.

**2. Create the sheets and columns the app expects.** A missing *column* is usually silent, not an error — the write path drops values it cannot map — so check the names rather than assuming:

| Sheet | What it needs |
|---|---|
| `events` | `id, date_from, date_to, title, author_user_id, color, role_id, rank_id, user_id, is_recurring, recurring_start, recurring_end, recurring_amount, recurring_frequency, is_sunday…is_saturday, date_of_month, is_all_day` |
| `announcements` | `id, effective_date, end_date, is_visible_on_login, is_visible_on_dashboard, is_visible_on_sidebar, role_id, rank_id, user_id, title, message, icon, context_variant, author_user_id, is_send_push_notification, is_dismissable` |
| `training` / `training_signatures` | the training columns listed in *Administration → System → Help → Training*, and `id, training_id, user_id` |
| `users` | `runner_sound_profile` and `is_change_password_on_login` (administrator-managed attributes, so they live here rather than in `user_settings`) |
| `schedule_templates` | `nickname`, `effective_date`, `end_date` |
| `assignments` | `color`, `icon`, `effective_date`, `end_date` |
| `roles` | one column per permission in [Role Permissions](#role-permissions) — `can_view_documents`, `can_manage_documents`, `can_verify_documents`, `can_create_events`, `can_make_announcements`, `can_view_system_log`, `can_access_debug`, the three training permissions, and the rest |
| `documents` | nothing — the sheet **creates itself** with its headers on the first save, and grows its header row for any column the code adds later. `id, title, folder, doc_type, sort_order, content, is_published, rank_id, is_sign_required, content_revision, author_user_id, updated_at` |
| `document_signatures` | nothing either — same self-creating sheet. `id, document_id, checklist_item_id, user_id, signed_by_user_id, signature_role, signed_at, content_revision`. The server stamps `signed_at`; `checklist_item_id` is blank for a whole-document signature and set for a checklist line. `signature_role` is `member` for the member's own signature and `verifier` for somebody else's confirmation of it |
| `document_checklist_items` | nothing either — same self-creating sheet. `id, document_id, sort_order, section, label`. The item ids are what signatures point at, so **editing an item keeps its signatures and deleting a signed one is refused** |
| `system_settings` | `session_timeout`, `is_sounds_active`, `required_clock_latitude`, `required_clock_longitude`, `gps_margin_of_error`, and the FCM keys |

`user_settings` is the exception: it **grows its own header row**, so `notify_announcements` and the other preference columns appear by themselves. All it needs is the identity column (`user_id`).

`push_devices` needs nothing from you either — it is created on first use, because a device registering into a sheet that does not exist would fail silently, which is the failure mode that feature has already produced once.

**3. Run the id migration, once.** Deploying the version of `Code.gs` that allocates UUIDs leaves the *existing* rows on their old sequential ids, so run the migration once from the Apps Script editor. The editor's **Run** button cannot pass arguments, so it is two functions — pick each in the toolbar's function dropdown and press Run:

```
checkIdMigration      step 1 - reports what it WOULD change, writes nothing
applyIdMigration      step 2 - applies it
```

It needs a free script lock, so ask everyone to close the portal first. It rewrites every record id **and every reference to one** (`user_id`, `role_id`, `schedule_id`, `approved_by`, …), resolves a legacy *username* in a user reference to that member, records the old→new mapping in an `id_migration` sheet so it can be checked or resumed, and signs everybody out at the end — their sessions carried the ids that just changed. Menus, timers and settings keys are unaffected. Read the report before applying: a **duplicate id** or a row **with no id** stops it, by design; a reference that names *nothing* (a deleted member, `Unknown`, a hand-typed value) is listed as left exactly as it is and does not stop anything. Background: [`docs/WRITE_SAFETY.md`](docs/WRITE_SAFETY.md).

**4. Tick the permissions** on the roles that should have them — *Administration → System → Help → Roles* explains what each one unlocks. A permission column that reads blank is treated as false, so an unticked box hides the tab.

**5. Add the repository secret and enable Pages** (steps 2 and 3 above).

**6. Restrict the Firebase web API key** to your Pages URL once you know it. The key is public by design, but restricting it by HTTP referrer stops anyone else using your project's quota — Google Cloud Console → APIs & Services → Credentials. **Allow the whole host, not just the app's path** (`https://<host>/*`): Firebase's Installations request arrives with the bare origin as the referer, so a path-scoped pattern blocks it and notifications cannot be enabled at all (see the troubleshooting note in `docs/FCM_SETUP.md`).

**7. Smoke-test the deployed site**: sign in, clock in/out, load My Schedule, open Administration, and check one admin tab per permission you granted. The guide at [`docs/FCM_SETUP.md`](docs/FCM_SETUP.md) has the push-notification end-to-end test.

### Notifications and installing as an app

- The site ships a web app manifest (`public/manifest.webmanifest`) with
  `display: standalone`, the department patch as icons (`public/icons/`, 16–512 px
  plus two `maskable` variants), an iOS `apple-touch-icon`
  (`icons/icon-180x180.png`), and 14 iOS launch images in `public/splash/`
  referenced from `index.html`. **The manifest is what makes iOS treat the app as
  installable**, which is a prerequisite for push there — see
  [`docs/FCM_SETUP.md`](docs/FCM_SETUP.md#7-members-opt-in-on-each-device).
- Brand colors come from the patch: `theme_color` and `background_color` are the
  patch's navy `#0A2A5B`, matching the icon background so install and launch look
  seamless.
- `public/badge.png` is the Android notification badge. Android draws badges from
  the **alpha channel** and tints them, so it must be a transparent silhouette -
  it was derived from the patch by keying out the navy background. To swap it,
  drop in any transparent-background PNG at 96×96 or larger.
- **Path rule:** files in `public/` are copied verbatim, so anything referencing
  them from *inside* `public/` (the manifest, the service worker) must use
  **relative** paths, while `index.html` uses absolute `/...` paths that Vite
  rewrites to the deployed base path at build time.
- After replacing artwork, rebuild and check nothing dangles. The repo ships a
  verifier that cross-checks every icon, splash image, badge, and script
  reference against the build output:
  ```bash
  npm run build
  python3 scripts/verify-pwa-assets.py --base /<repo-name>/
  ```
  It reports missing references (404s waiting to happen) and orphaned files that
  are shipped but never used.
- GitHub Pages serves over HTTPS at a real domain, which is required for
  service workers and push. `localhost` counts as secure for local development.
- `public/icon_old.svg` is an unreferenced leftover from an earlier placeholder
  icon and can be deleted.
- The service worker, manifest, and icons all use the deployed base path, so
  keep using `BASE_PATH` (the workflow sets it) rather than hardcoding paths.

### Security notes for a public deployment

- **The site is public; the API is not.** Only two backend actions are
  unauthenticated (`GET_INITIAL_DATA`, `LOGIN`); all 38 other actions require a
  session token, and admin actions additionally check `isAdminUser`. The
  deployment URL is embedded in the public bundle, so treat it as known to
  anyone.
- **Secrets are stripped from the public payload.** `GET_INITIAL_DATA` runs
  `publicSystemSettings` / `publicUserSettings`, which remove the FCM
  service-account credentials and replace each member's `fcm_token` with an
  `fcm_registered` boolean. Don't add credential keys to any new unauthenticated
  response.
- **The service-account private key is write-only.** It is never returned to a
  browser, not even to an authenticated admin; the admin screen only reports
  whether one is stored. For stronger handling, keep it in Apps Script Script
  Properties as `FCM_SERVICE_ACCOUNT_PRIVATE_KEY`
  (`FCM_SERVICE_ACCOUNT_EMAIL` alongside it) — the backend prefers that store
  over the sheet.
- **Restrict the Firebase web API key** (Google Cloud Console → APIs & Services →
  Credentials) to HTTP referrers for your Pages domain — the key ships in the
  client by design, but restricting it stops anyone reusing it elsewhere. **Use the
  host-wide pattern `https://<your-site-host>/*` rather than one scoped to your app's
  path**: Firebase's Installations call sends the bare origin as the referer, so a
  path-scoped pattern is refused with `403 PERMISSION_DENIED` and push cannot be
  enabled on any device.
- **`.env` and credentials stay out of git.** `.gitignore` covers `.env`,
  `.env.*` and the service-account JSON. `Code.gs` is deliberately **tracked** —
  it holds no credentials, and `scripts/check-secrets.py` (run in CI, in
  `verify:all` and by the pre-commit hook) fails the build if a key ever lands in
  it.
- **Passwords are stored as PBKDF2-HMAC-SHA256 hashes** with a unique 16-byte
  salt per member (`pbkdf2-sha256$iterations$salt$digest`). Legacy plain-text
  rows are upgraded on the member's next successful sign-in, and
  `migrateLegacyPasswords()` hashes the whole sheet at once. See
  [docs/AUTH_SECURITY.md](docs/AUTH_SECURITY.md).
- **Record ids are UUIDs**, so an id can never be reused after a delete: a `schedule_offers.schedule_id` could
  otherwise be handed to a different shift and an approval would fill the wrong slot. Existing data is migrated
  once with the `checkIdMigration` / `applyIdMigration` pair — see [docs/WRITE_SAFETY.md](docs/WRITE_SAFETY.md).
- **Concurrent saves cannot corrupt or silently double-write.** Writes are serialized
  by a script lock, and a write that cannot take it is **refused** (never run
  unlocked); a save built on a stale record is refused with the row as it now stands
  (`row_version`); a refused write is retried once by the client, because the server
  guarantees it wrote nothing. See
  [docs/WRITE_SAFETY.md](docs/WRITE_SAFETY.md).
- **The page cannot be overscrolled into a white band.** The app paints its background on a shell `<div>`,
  so everything below it was the browser's default canvas — white — and a trackpad flick or touch drag
  at the end of the page lifted the whole app to reveal it. The canvas is now painted in the shell's own
  colors, `overscroll-behavior-y: none` stops the reveal happening at all, and the desktop layout's
  inner scroll column contains its own overscroll so a long tab cannot drag the document up. See the
  note in `src/index.css` and `npm run verify:app-shell`, which fails if the canvas colors and the
  shell's classes drift apart.
- **A long help guide scrolls inside its own card.** The guide pane is bounded on desktop and
  scrolls, so the bookmark list (and the card header) stay where they are however long a guide is,
  rather than being carried off the top of the page. It needs the whole height chain to hold — the
  card bounded, the columns taking the height left over it, `min-h-0` so a column may shrink below its
  content, and a definite row — so `npm run verify:app-shell` checks every link, both call sites
  (including that the Administration panel hands down a height, and that neither caller wraps the
  component in an auto-height element). Opening a guide also starts at the top of it.
- **Sign-in is two requests, not seventeen.** An administrator's sign-in used to fire two waves of nine
  Apps Script executions — six of them fetching what the other wave already had — and every execution pays a
  second or three of startup. The calls at the back of that pile were the ones that ran out of the client's
  60-second patience, and a call that gives up is data the screen never gets: no shifts on the calendar, a
  12-hour clock for a member who chose 24. Now one request returns everything a member's sign-in needs
  (`GET_BOOTSTRAP`) and one returns everything an admin screen reads (`ADMIN_GET_BOOTSTRAP`) — both built
  from the same helpers the individual actions use, so the two paths cannot disagree about what a roster or a
  schedule is. Reads an older client asks for twice in the same moment are sent **once** and shared
  (`utils/readCoalescing`), and whatever still fails is **retried once, one at a time**, with one console line
  naming what is missing (`utils/refreshWave`). Nothing is cached: a read after a write always sees the write,
  and a write never joins anything. `npm run verify:bootstrap` runs the new payloads against a fake spreadsheet,
  `verify:refresh-wiring` audits both halves of the wiring, and `verify:read-coalescing` counts the requests.
- **A calendar day reads in the order it happens.** Events used to be drawn above every shift, so a
  6 PM event sat over the morning shift. The pills are interleaved by start time instead, and where an
  event and a shift start at the same moment the event goes first — it is context for the day rather than
  work in it. The printed sheet follows the same rule, and the rule itself lives in `src/utils/dayOrder.js`:
  `npm run verify:day-order` covers the merge (including that a shift with no time is *not* read as
  midnight) and that all three pill calendars are still wired to it.
- **A refused drag on the schedule board always explains itself.** Losing a pill used to do nothing at
  all in four different situations — dropping onto an open shift, onto a past day, back where it
  started, or on a day's empty space — and "nothing happens" is indistinguishable from a broken app.
  Every drop now gets a verdict from one pure planner (`utils/scheduleDrop`), which either moves the
  row, fills a vacancy, or refuses *with a reason*. Dropping a pill onto somebody else's shift is a
  refusal too, and it says so: the way to exchange two shifts is to **hold** the pill there for a
  moment, which blinks while the hold is read and then shows the two exchanged — letting go keeps it,
  moving out puts them back.
- **No record ids are shown on screen.** Every place that used to print one — an `Edit User #9f2c1e0a…`
  heading, an ID column in two admin tables, a `#assignment_id` chip on the member calendar,
  administrator filter dropdowns, the author line under an announcement, the printed schedule, the
  timeclock export, and a dozen "could not find that member" fallbacks — now names the record, or says
  **Unnamed member**. A UUID cannot be compared by eye, is wider than the column it sits in, and shows
  whoever is looking at the screen how the records are keyed. The wording comes from one helper
  (`src/utils/displayLabel.js`), and `npm run verify:no-raw-ids` fails if any of those shapes come back —
  as does `verify:admin-render`, which renders the tabs that had them.
- **Destructive actions ask in the app, not in a browser dialog.** Deleting a user, an event, a
  training (and its signatures with it), a timeclock entry and the rest used `window.confirm` —
  thirteen of them, across eleven administrator tabs. They now ask in one shared `ConfirmModal`,
  which is styled like the rest of the app, sounded like any other modal, dismissible with Escape
  or a click outside, and — the part a browser dialog cannot do — *names* what is about to be lost,
  in bold, instead of squeezing it into a sentence. The row is held in the tab's own state while
  the dialog asks, so nothing is written before the answer. `npm run verify:confirmations` fails if
  a native dialog ever comes back, and renders the dialog to check what a screen reader would get.
- **The interface has sounds, and one switch to silence them.** A click for every press
  on a control, a heavier one for consequential actions (save, delete, edit, cancel,
  export, print, sign out), a tone for each modal, one for each toast kind, and the
  notification sound for a push that lands while the app is open. All of it comes from
  **one delegated listener** rather than ~130 call sites, so a new button is audible
  without being told to be — including whether it is an *action*, decided from the
  control's own label or icon. The member's switch is `user_settings.is_sounds_active`,
  which inherits the station default from `system_settings` and defaults to on. The
  Firefighter Runner keeps its own audio and is excluded from the click. See
  [docs/SOUNDS.md](docs/SOUNDS.md), including the list of places that are deliberately
  silent.
- **Sign-in is throttled.** Five failed attempts locks a username out for 60 s,
  doubling to a 15-minute cap; a global cap of 200 failures per 15 minutes
  refuses every sign-in regardless of username. Counters live in `CacheService`,
  so a locked-out attempt never touches the sheet. The code fails **open** if the
  cache is unavailable, so an outage cannot lock everyone out — run
  `diagnoseAuthSecurity()` to confirm the cache is reachable.
- **Known limitation to be aware of:** Apps Script offers no bcrypt or Argon2, so
  the PBKDF2 iteration count that fits its per-request bridge overhead is far
  below what a native runtime would use. This removes recoverable secrets from
  the sheet and rate-limits guessing, but it is not equivalent to a native
  password-hashing cost factor. Encourage passphrases, and treat Google SSO as
  the real upgrade path.
- **Known gap — `can_approve_shifts` now drives the UI and delivery, but check your
  roles.** The Pending Approvals tab, the User Settings **New shift requests** switch
  and the `SUBMIT_SHIFT_OFFER` notification recipients all key off
  `can_approve_shifts` (with `is_admin` implying it). A role that is expected to
  approve shifts must therefore have **either** flag set; a role with neither sees no
  Pending Approvals tab and receives no new-request pushes. The approval *screen*
  itself is admin-only no longer — it is permission-based like every other tab.
- **`src/services/Code.gs` is in version control, deliberately.** It contains no
  credentials: the FCM service-account key, web config and VAPID keys live in the
  `system_settings` sheet and Script Properties, and the file refers to them only by key
  name. It also uses `getActiveSpreadsheet()`, so no spreadsheet ID appears in it. Note
  what publishing it *does* reveal: the sheet and column names, the permission names, and
  the password hash format. None of that grants access — sessions and Google's sharing
  rules are the controls — but **keep the spreadsheet itself unshared**, and never paste a
  key into the file.
- **A guard stops a credential reaching the repo.** `scripts/check-secrets.py` scans the
  tracked files for key material and for credential *filenames*, and runs in three places:
  CI (before lint, so the build fails), `npm run verify:all`, and a pre-commit hook.
  Enable the hook once per clone:

  ```bash
  git config core.hooksPath scripts/git-hooks
  ```

  The rules are deliberately narrow — the FCM form prints `-----BEGIN PRIVATE KEY-----` as
  placeholder text and `Code.gs` lists `fcm_service_account_private_key` as a settings key,
  so a bare keyword search would fail on a clean tree. Each rule requires a *value*.
  Rotate a key the moment a finding ever appears: removing it in a later commit does not
  unpublish it, because the commit stays reachable by SHA and every clone keeps its copy.
