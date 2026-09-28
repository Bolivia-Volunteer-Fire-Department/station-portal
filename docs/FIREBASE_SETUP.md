# Firebase Setup

What has to be done in the Firebase and Google Cloud consoles, in the order that works. **The code side is done** -
the rules, indexes and functions are in this repo and deploy with the commands below. This is the account and project
side, which only you can do.

Two things to know before the list:

- **The first administrator cannot be created by the app.** `createMember` requires an officer and there is no
  officer yet, so step 6 bootstraps one by hand. Everything after that is the app's own Users tab.
- **Nothing here costs money at station scale.** Blaze is required for Cloud Functions - that is the only reason it
  is needed - and the free allowances cover a station by a wide margin: Firestore's no-cost tier alone is 50,000
  document reads and 20,000 writes a day, against a station making a few hundred requests on a busy day.

## 1. Confirm the project, and the id in the repo

`.firebaserc` names `fire-clock-76723`, which was inferred from the service-account filename in `.gitignore` rather
than chosen deliberately. Check it against the console and correct it if it is wrong:

```bash
npx firebase use --add        # pick the project; this writes .firebaserc for you
```

## 2. Put the web app's config in `.env` and in CI

**The web app is already registered**, because push notifications needed it - so this is a copy, not a setup. The
values are in the `system_settings` sheet, where the app reads them today at runtime:

| `system_settings` key | environment variable |
|---|---|
| `fcm_api_key` | `VITE_FIREBASE_API_KEY` |
| `fcm_auth_domain` | `VITE_FIREBASE_AUTH_DOMAIN` |
| `fcm_project_id` | `VITE_FIREBASE_PROJECT_ID` |
| `fcm_app_id` | `VITE_FIREBASE_APP_ID` |
| `fcm_messaging_sender_id` | `VITE_FIREBASE_MESSAGING_SENDER_ID` |
| `fcm_vapid_public_key` | `VITE_FIREBASE_VAPID_KEY` |

(`fcm_web_config` holds the same values as one JSON blob, if that is easier to read; `fcm_storage_bucket` is not
needed, because there is no Firebase Storage in this design. In the console the same config is under Project
settings → Your apps → Web → SDK setup and configuration.)

For local development, copy `.env.example` to `.env` and paste the values in - or skip it entirely and set
`VITE_FIREBASE_EMULATOR=1`, which points the app at the local emulators instead and needs no project config at all.

For the **deployed** site the values have to be repository secrets (Settings → Secrets and variables → Actions),
because a CI build has no `.env` - it is gitignored. The deploy workflow passes all six through to the build. They
are deliberately optional: an unset secret arrives as an empty string, `src/services/firebase.js` reports itself
unconfigured, and the app stays entirely on Apps Script until the login switches over.

They are **not secrets** - a Firebase web config is public by design, and the project is protected by the rules and
App Check. The one thing worth doing to the API key is the restriction the deploy checklist already mentions in the
README: allow the GitHub Pages host, and `localhost` if you want to develop against the real project rather than the
emulator.

## 3. Turn on Authentication

- **Sign-in method** → enable **Email/Password**. Nothing else: no other provider, no verification, no reset by
  email, because the addresses are synthetic (`username@boliviavfd.invalid`) and no mail is ever sent.
- **Settings → Email enumeration protection**: on.
- **Settings → Authorized domains**: `localhost` is there by default; **add the GitHub Pages host**
  (`<your-org>.github.io`). Sign-in fails on the deployed site without it, and the failure is not obvious.
- Resets are officer-driven: `resetMemberPassword` sets a temporary password and flags the member to change it.
  There is no self-service reset, deliberately, and no inbox to send one to.

## 4. Create the Firestore database

Cloud Firestore → **Create database** → **production mode** (the rules come from this repo, not the console) → pick a
**location**. The location is permanent, so choose it once: `nam5` for a US multi-region, or a single US region near
the station. It is the one decision here that cannot be undone.

## 5. Deploy the rules, indexes and functions

```bash
npm --prefix functions install      # once, and again after any change to functions/package.json
npm run deploy:firestore            # rules + indexes
npm run deploy:functions
```

The indexes take a few minutes to build the first time. Firestore reports a missing index in the browser console
with a link if a query needs one - but they are all in `firestore.indexes.json`, so that should not happen.

## 6. Bootstrap the first administrator

Five documents and a user, all in the console, and only the first one. In **Authentication → Users → Add user**,
create the synthetic address and a temporary password - the address is the username plus the department's reserved
domain, for example `chief@boliviavfd.invalid`. Write the username down; it is what they type to sign in.

Then in **Firestore**, with the UID Firebase assigned:

| document | contents |
|---|---|
| `roles/administrator` | `description: "Administrator"`, `is_admin: true`, **and every permission flag set to `false`** |
| `ranks/<something>` | `description`, `rank_order`, `color`, `icon` - first, since `rank_id` points at one |
| `users/<UID>` | `name`, `rank_id`, `role_id: "administrator"` |
| `users_private/<UID>` | `username` (as typed above), `status: "active"` |
| `user_settings/<UID>` | `time_format: "24"`, `is_dark_mode: false` |

**Every flag on the role, not just the ones granted.** A role document carries the whole set of thirty, because
reading an absent key in the security rules is an evaluation error rather than a false - which a client cannot tell
apart from a correct refusal. `scripts/seed-emulator.mjs` lists all thirty to copy.

Custom claims can be left empty. The rules read the role document rather than the token, so access is correct either
way; the claims only save the client a read.

From there the first administrator creates everyone else through the app's Users tab.

## 7. Guardrails worth doing in the same sitting

- **Budget alerts**: Cloud console → Billing → Budgets & alerts. A $5 monthly budget with email alerts catches a
  mistake, and at station scale it will never fire.
- **App Check**: Firebase → App Check → register the web app with reCAPTCHA v3, then turn on enforcement for
  Firestore and Cloud Functions. This is what stops somebody scripting the API from a laptop. The code side - the
  site key and `initializeAppCheck` - is a small change on our side that has **not** been made yet.
- **Project ownership**: add two or three people from the department as **Owner** in Google Cloud → IAM. The app
  currently depends on one person's account, and that is the largest single risk in the whole arrangement.

## 8. Later, not now

- **Firebase Hosting** instead of GitHub Pages (preview channels, a custom domain, 10 GiB of free bandwidth).
- **Realtime Database for chat presence.** `onDisconnect` is the right tool for who is *online* and the wrong tool
  for who is *on duty*: a member stays on duty with the app closed, which is the point of a timeclock, and
  `onDisconnect` would silently clock people out.
- **The reporting mirror**, so a spreadsheet can still be pivoted. A scheduled function exporting collections to a
  Sheet needs the Sheets API enabled and a service account, and it wants deciding deliberately rather than
  discovering as missing after go-live.

