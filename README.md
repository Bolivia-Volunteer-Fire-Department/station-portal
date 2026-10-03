# Station Portal

A station timeclock app built with **React 19 + Vite + Tailwind CSS 4**, backed by **Firebase**
(Firestore for data, Firebase Auth for sign-in, Cloud Functions for the work a browser must not be
trusted with). Clock in/out with GPS location, review history, check assigned shifts on the schedule
calendar, and manage users, roles, ranks, shifts and system settings from the Administration module.

## Where the documentation lives

**App usage is documented in the app, not here.** Members have a **Help** module in the sidebar;
administrators have **Administration → System → Help**. Both sets are markdown files in this repo:

```text
src/content/help/member/*.md    the Help module (everyone)
src/content/help/admin/*.md     Administration → System → Help
```

Adding a guide is adding a file — the first `# heading` becomes its title, and a numeric filename
prefix (`01-`, `02-`) sets the order. The authoring rules are in [Help guides](#help-guides) below.

**This README is the developer documentation**: local setup, the Firebase project, the data model,
push notifications, design notes, the verification suite and deployment. (The former `docs/` folder
was folded in here, and the retired Google Apps Script/Sheets backend was deleted.)

## Requirements

- Node 22+ (CI deploys Cloud Functions on the Node 22 runtime; an `npm warn EBADENGINE` about a
  newer local Node is expected and harmless)
- A Firebase project on the **Blaze** plan — Cloud Functions require it, and the free allowances
  cover a station by a wide margin (Firestore's no-cost tier alone is 50,000 reads and 20,000
  writes a day)
- **JDK 21+** for the emulator-based suites (`verify:rules`, `verify:firebase-auth`,
  `verify:firestore-reads`, `verify:firestore-writes`): the Firestore emulator refuses Java 8. On a
  Mac with Homebrew: `brew install openjdk@21`, then
  `export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`

## Local development

```bash
npm install
cp .env.example .env      # then fill in the values (see below)
npm run dev
```

### Environment variables

The Firebase **web config is public by design** — the project is protected by `firestore.rules` and
App Check, not by hiding these values. They come from Firebase console → Project settings → Your
apps → Web app → SDK setup and configuration.

| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_API_KEY` / `AUTH_DOMAIN` / `PROJECT_ID` / `APP_ID` | the web app config |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | push sender id |
| `VITE_FIREBASE_VAPID_KEY` | Web Push certificate key (push notifications) |
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | reCAPTCHA Enterprise site key; empty = App Check off |
| `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` | **local only, never a repo secret** — App Check debug token for `localhost` |
| `VITE_FIRESTORE_FEATURES` | kill switch: unset = all routes; a comma list = only those; `off` = none |

For local development against **no real project at all**, set `VITE_FIREBASE_EMULATOR=1` (or export
`FIRESTORE_EMULATOR_HOST`, which the harnesses do) and skip the config entirely.

## Emulators

```bash
npm run emulators         # Firestore + Auth emulator; emulator UI on http://127.0.0.1:4000
npm run emulators:seed    # a demo station: one administrator, one member, an open shift, one member on duty
```

The seeded demo project is `demo-station-portal` (see `.firebaserc`). Seed it and you can develop
every feature with no Firebase project and no network.

## Verification

`npm run verify:all` runs the secret scanner, the linter and every harness below (the
emulator-based ones last). Each harness is a plain Node script driven through `vite build --ssr`, so
it imports the real modules rather than copies of them.

| Script | What it proves |
|---|---|
| `verify:rules` | `firestore.rules`, exercised by signing in as each seeded role; every refusal is paired with an allowed case |
| `verify:firebase-auth` | the callables: officer-only password/reset flows, the runner score, push-device ownership |
| `verify:firestore-reads` / `-writes` | payload shapes and write rules against the emulator |
| `verify:backend-routing` | every `api.js` action routes to Firestore or a callable, and nothing dangles |
| `verify:read-budget` | sign-in costs a bounded number of reads; nothing large loads without its screen |
| `verify:refresh-wiring` | every saving tab asks for a refresh, and no tab awaits the fan-out |
| `verify:permissions` | the permission catalog, its dependencies and the tab mapping agree |
| `verify:help` | the help guides load, are numbered `01..N`, and cover every tab and member module |
| `verify:sounds` / `verify:motion` | the sound wiring and the motion budgets |
| `verify:app-shell` | every `verify:*` script is actually listed in `verify:all` |

A credential guard runs before all of it: `scripts/check-secrets.py` scans tracked files for key
material and requires a *value*, not a keyword (the FCM form legitimately prints
`-----BEGIN PRIVATE KEY-----` as placeholder text). It runs in CI, in `verify:all`, and in a
pre-commit hook — enable the hook once per clone:

```bash
git config core.hooksPath scripts/git-hooks
```

If a finding ever appears, rotate the key immediately: removing it in a later commit does not
unpublish it, because the commit stays reachable by SHA and every clone keeps its copy.

## Help guides (authoring rules)

- One guide per module and per tab; **coverage is asserted** — a new tab without a guide fails
  `verify:help`, as does a guide whose slug does not match a tab id.
- Numbering is **`01..N` with no gaps and no duplicates**; the number is the order the thing appears
  in the app, not the order the guides were written.
- **One line per paragraph, one line per list item — never hard-wrap.** The parser is line-based:
  a wrapped list item ends the list, and a wrapped emphasis span renders as literal asterisks.
  `npm run fix:guides` (`scripts/reflow-guides.py`) reflows for you.
- GitHub alerts (`> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`) render as
  callouts; an unknown marker stays literal text rather than being styled as something it is not.
- The markdown is parsed by `src/utils/markdown.js` into a data tree rendered by `Markdown.jsx` —
  no `dangerouslySetInnerHTML` anywhere, so HTML in a guide renders as text. Supported: headings,
  emphasis, inline code, fenced code, links, lists, quotes, rules, tables, `==highlight==`.

## Firebase project setup

What has to be done in the Firebase and Google Cloud consoles, in the order that works. The code
side is done — the rules, indexes and functions are in this repo and deploy with the commands below.

1. **Confirm the project.** `.firebaserc` names `fire-clock-76723`; check it with
   `npx firebase login` and `npx firebase projects:list`, and correct `.firebaserc` if it is wrong.
2. **Put the web app's config in `.env` (local) and in repository secrets (CI).** The deploy
   workflow passes every `VITE_FIREBASE_*` secret through to the build; an unset one arrives empty
   and the app reports itself unconfigured. Restrict the web API key to your deployed host
   (Google Cloud console → APIs & Services → Credentials) — allow the whole host
   (`https://<host>/*`), because Firebase's Installations call sends the bare origin as the referer.
3. **Turn on Authentication → Email/Password.** Nothing else. Set **Email enumeration protection**
   to on, and add the deployed host (`<your-org>.github.io`) to **Settings → Authorized domains** —
   sign-in fails on the deployed site without it, and the failure is not obvious. Password resets
   are officer-driven (`resetMemberPassword` sets a temporary password and flags the member to
   change it); there is no self-service reset, and no verification/reset mail is ever sent.
4. **Create the Firestore database** in **production mode** (the rules come from this repo) and
   pick a **location** — permanent, so choose once: `nam5` for a US multi-region, or a US region
   near the station.
5. **Deploy the backend:**

   ```bash
   npx firebase use fire-clock-76723 --alias default   # non-interactive; only needed once
   npm run deploy:firestore                            # rules + indexes
   npm run deploy:functions
   ```

   The indexes take a few minutes to build the first time. `npm warn EBADENGINE` is expected (see
   Requirements). If the functions deploy reports it *could not set up a cleanup policy*, the deploy
   worked; set the Artifact Registry policy by hand once per location:
   `npx firebase functions:artifacts:setpolicy --location us-central1 --days 1 --force`. Do **not**
   reach for `firebase deploy --force`: on deploy it also skips the confirmation before deleting
   functions that are no longer in the source.
6. **Close self-sign-up.** The email/password provider cannot refuse direct API sign-ups, so
   `beforeUserCreated` in `functions/index.js` (a blocking function) does it: it refuses anything
   that did not come from the Admin SDK and any address outside the station domain. It needs the
   console's **Identity Platform** upgrade (one click; free at this scale) and a second
   `deploy:functions` afterwards — deploying again is what registers the trigger. It fails closed.
   The Auth emulator cannot exercise it, so verify once by hand after each functions deploy:

   ```bash
   KEY=$(grep VITE_FIREBASE_API_KEY .env | cut -d= -f2)
   curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$KEY" \
     -H 'Content-Type: application/json' \
     -d '{"email":"someone@example.com","password":"password123","returnSecureToken":true}'
   ```

   Blocked looks like a 400 with no `idToken`. An `idToken` means the block is not active.
7. **Bootstrap the first administrator.** `createMember` requires an officer and there is none yet,
   so the first one is created by hand — in **Authentication → Users → Add user**, create the
   synthetic address (`<username>@<station-domain>`) and a temporary password; the username is what
   they type to sign in. Then in Firestore, using the assigned UID (all five documents share it):

   | document | contents |
   |---|---|
   | `roles/administrator` | `description`, `is_admin: true`, **and every permission flag (all thirty, set explicitly)** |
   | `ranks/<id>` | `description`, `rank_order`, `color`, `icon` |
   | `users/<UID>` | `name`, `rank_id`, `role_id: "administrator"` |
   | `users_private/<UID>` | `username`, `status: "active"` |
   | `user_settings/<UID>` | `time_format: "24"`, `is_dark_mode: false` |

   Every flag on the role, not just the granted ones: reading an absent key in the rules is an
   evaluation error, which a client cannot tell apart from a correct refusal.
   `scripts/seed-emulator.mjs` lists all thirty to copy. From here, everyone else is created
   through the app's Users tab. Custom claims can stay empty — the rules read the role document.
8. **Guardrails, the same sitting:** a **budget alert** (Billing → Budgets, $5/month) so a mistake
   is a line on a bill rather than an outage; **two or three Owners** in Google Cloud → IAM, because
   one person's account is the largest single risk in the arrangement; and **App Check** (below).

### App Check, in the order that does not lock the station out

App Check stops somebody scripting the API from a laptop. The code side is done (`initializeAppCheck`
runs when `VITE_FIREBASE_APPCHECK_SITE_KEY` is present); the console work has an order that matters.

1. Create a **reCAPTCHA Enterprise score-based key** in the Google Cloud console, in the **same
   project** as Firebase. It belongs on the same host list as the API key.
2. Deploy the client with the key set: tokens start being sent, and unverified requests still work.
3. Watch **App Check → APIs** for a few days; when unverified requests have fallen to ~zero, turn on
   enforcement per product in the console. **Cloud Functions are the exception**: enforcement for a
   callable is set in the function's own options (`enforceAppCheck: true` in `functions/index.js`)
   plus a redeploy — deliberately not switched on yet.
4. Turn on **billing with the budget alert** before enforcement: an unbilled project that passes
   10,000 assessments stops serving.

Local development: `localhost` is not attested, so either create an App Check **debug token** and
put it in your **local** `.env` as `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` (it is a credential — never
a repository secret, since Vite inlines every `VITE_*` value into the bundle), or add `localhost`
to the site key's domains (use a separate development key). With a site key and no debug token the
SDK fills the console with reCAPTCHA errors and never backs off — which is why
`src/services/firebase.js` declines to initialise App Check on a loopback origin at all, and says so
once. The deployed site is unaffected.

Later, not now: Firebase Hosting instead of GitHub Pages; Realtime Database for chat presence
(`onDisconnect` is right for *online*, wrong for *on duty*); a scheduled reporting mirror to a
spreadsheet.

## Push notifications (FCM)

| Piece | Where it lives | Job |
|---|---|---|
| Firebase web config + VAPID public key | `.env` / repository secrets (`VITE_FIREBASE_*`) | let a browser register for push |
| Service account | the Cloud Functions runtime's own identity | send messages (no key to paste anywhere) |
| Device tokens + opt-in switches | `push_devices` collection + `user_settings` | per-device registration and preferences |
| Service worker | `public/sw.js`, built to `/sw.js` | receive messages, show the notification, focus the app on click |
| Sender | Firestore triggers in `functions/index.js` | fire on shift-offer changes |

Setup: the web app config and VAPID key are build values (the table above) — the console work is
**Project settings → Cloud Messaging → Web Push certificates → Generate key pair** (`B...`).
Sending needs **no service-account JSON**: the Cloud Functions runtime carries its own identity, and
the sender is a Firestore trigger on an offer write, so nobody has to remember to send. Audience
resolution (`who is told about what`) is the pure half in `functions/pushAudience.js`
(`npm run verify:push-audience`).

Members opt in per device: **User Settings → Shift Notifications → Enable** (iPhone/iPad requires
Add to Home Screen first). Station defaults are configured by an officer in
**Administration → System → Notifications** — the member-facing walkthrough is in the help guides
(*Help → User Settings*, and *Administration → System → Help → Notifications*).

Testing and troubleshooting: send a test push from the Notifications admin tab; delivery does not
depend on the app being open, but the page must have been loaded at least once after registration so
the service worker is installed. A device that stops receiving is usually a stale token — they are
pruned on send.

## Data model

One collection per thing the app stores, one writer per collection, one rule. This section is the
contract; `firestore.rules` is the enforcement.

Five rules keep one-source-of-truth true in a database that cannot join or project:

1. **One writer per fact** — a second writer is a bug.
2. **A split holds different facts, never a copy** — `users`/`users_private` share an id and hold
   disjoint fields; if two documents need the same field kept in step, move the field.
3. **A materialized value is derivable from the normalized data** and is written by the same
   transaction that changes its source (e.g. `on_duty` from the clock entry, `is_open`,
   `audience_keys`, `certification_badges`).
4. **Claims are a cache.** Auth custom claims refresh ~hourly; the role document is the source of
   truth and the rules read it, so a role change takes effect on the next request.
5. **Nothing sensitive shares a document with something public** — no password, no FCM token next to
   a roster row. A document is the unit of permission, which is why private halves exist.

| area | collections | notes |
|---|---|---|
| identity | `users` (public roster: name, rank_id, role_id, runner_score) · `users_private` (username, status) · `user_settings` (preferences, keyed by uid) · `roles` · `ranks` · `push_devices` | one id per member, shared by all their documents, and that id is the Auth uid |
| configuration | `settings/public` · `settings/private` · `shifts` · `assignments` + `assignment_private` (officer notes) · `schedule_templates` + `schedule_template_private` | private halves hold officer-only fields; written in the same batch as the public row |
| schedule | `schedule` (empty `user_id` = open shift, derived `is_open`) · `availability_windows` · `availability_months/{uid}_{YYYY-MM}` (one document per member per month) · `schedule_offers` (derived `slot_key`) | `schedule` grows without limit, so it is **never read at sign-in** — calendars ask for the month they show |
| timeclock | `timeclock` · `on_duty` (one document per member whose shift is open, written by the clock transaction) | the dashboard's "am I clocked in" is answered by `on_duty`, not by scanning history |
| training & certs | `trainings` · `training_signatures` · `certifications` · `certification_setup` · `certification_badges` (materialized per member) | the badge index keeps the roster honest; certification *state* is derived at read time and never stored |
| documents | `documents` · `document_checklist_items` · `document_signatures` | signatures are per member, per item, verifier-attributed |
| communication & audit | `announcements` · `events` (materialized `audience_keys`) · `system_log` (**Functions only** — an audit row a browser could forge is not an audit row) | |

**Reads are audience- and time-bounded.** The member payload is one parallel wave gated by the
role's permissions; `schedule`, the clock history, events and every admin tab load when their screen
opens. `verify:read-budget` holds that line.

**Offline.** Firestore's local cache means reads work with no signal. Clocking in/out refuses while
offline on purpose: a queued write is timestamped by the device, and that record asserts someone was
at the station. Every other write queues and lands on reconnect.

**Indexes** live in `firestore.indexes.json` and are reviewed like code. The system log is read
through the `readSystemLog` callable and scans in memory on purpose — its counts and filter facets
span the whole log, which an index cannot answer.

**Migrating the station's data**: `npm run migration:recon` / `migration:plan` / `migration:write`
read the original spreadsheet and write Firestore documents; `scripts/migration-map.mjs` is the
column mapping the tools execute, and `verify:migration-map` holds it against the rules. Secrets
(FCM keys, anything credential-shaped) are refused rather than copied.

## Design notes

- **Concurrency.** Where two writers can corrupt each other, the work is a **Firestore transaction**
  or a callable: clock in/out (refuses a second open shift), offer approve/decline (fills the shift
  in the same transaction), the runner score (improve-only, clamped, repairs a non-numeric stored
  score). Everything else is last-writer-wins by decision — a stale save is not checked — and bulk
  writers (the schedule board owns a whole month) deliberately send no version. The audit trail for
  officer actions is written by the callables only.
- **Auth.** Sign-in is a username + password against Firebase Auth, where the username is the local
  part of a synthetic address on the station's reserved domain. Passwords are Firebase's problem;
  resets are officer-driven and set a temporary password plus the change-at-login flag, which the
  `completePasswordChange` callable clears after the member changes it. Self-sign-up is refused by
  the `beforeUserCreated` blocking function (Firebase setup, step 6).
- **Session idle timeout.** `session_timeout` in system settings (minutes) drives a one-second
  client tick that warns in the final minute and signs the member out at the threshold; navigating
  between modules counts as activity. Firebase's own token lifetime is independent of it. The state
  machine is exercised by `verify:session-timeout`.
- **Refresh waves.** Screens read React state loaded once and refreshed on demand.
  `refreshAdminData` in `App.jsx` reloads every cache an admin screen reads in one parallel wave;
  every saving tab starts it and does not await it, merging the row it just saved into state
  (`utils/savedRow.js`) so the table is correct the moment the write returns. The two rules —
  reload everything, and every saving tab must ask — are enforced by `verify:refresh-wiring`, and
  the wave reports its own progress through a toast (`utils/activity.js`).
- **UI sounds.** Nine files in `src/assets`, one delegated listener (`utils/uiSounds`) instead of
  ~130 call sites: a click for every press, a heavier click for consequential actions, a tone per
  modal and per toast kind, a notification sound for pushes landing in-app. `data-sound="click"` /
  `"click-double"` / `"none"` adjust or silence a control or subtree, and there is a documented list
  of places that are deliberately silent. `verify:sounds` holds the wiring.
- **Motion.** One vocabulary in `src/index.css` (`--motion-quick` 110ms, `--motion-base` 160ms), a
  ~200ms budget, nothing loops, and every animated rule must appear in its
  `prefers-reduced-motion` block. `verify:motion` measures all three. The one deliberate exception
  is the splash (`SplashScreen.jsx`): a brand moment played once per page load — the patch at 60% of
  the viewport's height on the same canvas as the login screen, while the app's data loads
  concurrently underneath — whose durations sit outside the vocabulary by design; still one-shot and
  reduced-motion-aware, which is what the harness holds it to. The iOS launch images
  (`public/splash/`, referenced from `index.html`) are that same frame as static PNGs, so an
  installed app hands off seamlessly; regenerate them with `npm run make:splash` after changing the
  splash's canvas or logo size (needs a Chromium-based browser). Dialogs render into
  `document.body` via `utils/viewportLayer` (fixed positioning against a transformed ancestor was
  clipping a calendar popup), and the dismiss animation is sequenced in `utils/motion` because CSS
  cannot animate an element the parent is about to unmount.

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds the app and publishes it to GitHub Pages automatically.

1. Create the repository and push the code.
2. Add the `VITE_FIREBASE_*` values from `.env.example` as **repository secrets** (Settings →
   Secrets and variables → Actions) — a CI build has no `.env`. They are the web config, which is
   public by design; the controls are the rules and App Check, not secrecy.
3. Enable GitHub Pages with **Source: GitHub Actions**, then push to `main`.
4. The workflow sets the base path from the repository name; the app is published at
   `https://<your-org>.github.io/<repo-name>/`.

### Before you publish: the checklist

1. **Deploy the backend**: `npm run deploy:firestore` (rules + indexes) and
   `npm run deploy:functions` — see the Firebase setup section above, including the Identity
   Platform upgrade and the self-sign-up check.
2. **Seed the station's data** (collections and shapes: the table above;
   `npm run migration:*` from the original spreadsheet).
3. **Add the repository secrets and enable Pages** (steps 2 and 3 above).
4. **Restrict the Firebase web API key** to your Pages host — whole host, not just the app's path
   (Firebase's Installations request sends the bare origin as the referer).
5. **Smoke-test the deployment**: sign in, clock in/out, open My Schedule, Administration, and one
   admin tab per permission; then the push end-to-end test from the Notifications admin tab.

### Security notes

- **The site is public; the data is not.** `firestore.rules` deny everything not explicitly
  granted, App Check attests the client where enabled, and the rules — not the API key — are the
  control. Never paste a credential into the repo; `check-secrets.py` is the tripwire, not the
  control.
- **The service-account identity lives in the Cloud Functions runtime** and is never returned to a
  browser, not even to an authenticated administrator; the Notifications admin tab only reports
  whether sending is configured.
- **Keep project ownership distributed** (two or three Owners in Google Cloud IAM) and keep the
  budget alert on.
