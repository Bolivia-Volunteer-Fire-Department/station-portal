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
npx firebase login
npx firebase projects:list   # confirm you can see fire-clock-76723
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

- **Sign-in method** → enable **Email/Password**. Nothing else - no other provider.
- **Settings → Email enumeration protection**: on, so Auth does not reveal whether an address exists.
- **Settings → Authorized domains**: `localhost` is there by default; **add the GitHub Pages host**
  (`<your-org>.github.io`). Sign-in fails on the deployed site without it, and the failure is not obvious.
- Resets are officer-driven: `resetMemberPassword` sets a temporary password and flags the member to change it. No
  self-service reset, deliberately.

**There is nothing to turn off for verification or reset mail**, and it is worth knowing that before hunting for it.
Auth sends a verification or a reset email only when the app ASKS it to, and this app never does - there is no
"send these automatically" setting to disable. What is left is the two settings above.

**One gap worth knowing about:** the email/password provider cannot be closed to self-sign-up, and the API key is
public, so somebody could create their own Auth account. They would get no role, and therefore nothing to see - the
rules deny everything to a user with no roster row - but the account would exist, and it would count toward the
project's users.

### Closing self-sign-up

`beforeUserCreated` in `functions/index.js` closes it: a blocking function that runs on every account creation and
refuses anything that came from a browser. The Admin SDK's own creations - `createMember`, the only legitimate way in
- are told apart by having no IP address and no user agent. It also refuses any address outside the station domain.

Two things it needs:

1. **Identity Platform.** Blocking functions require the project to be upgraded, which is a single click in the
   console (Authentication → the upgrade prompt) and free at this scale. Deploying the function without the upgrade
   simply leaves it unused.
2. **A deploy** - `npm run deploy:functions`. **Do it after the upgrade as well as before:** the trigger is
   registered with Identity Platform when the function deploys, so deploying again is what guarantees the two know
   about each other. `firebase functions:list` should show eight functions, `beforeUserCreated` among them.

It is worth knowing that blocking functions **fail closed**: if the function cannot run, account creation fails
rather than quietly falling through. That is the correct way round for a security control, and it is why its logic is
three lines long - the more it does, the more ways it has to stop an officer adding a member.

**To check it worked**, ask the Auth REST API for an account, which is exactly what the client SDK does underneath -
and the only route that works today, because the app itself still has no Firebase in it (see step 2):

```bash
# The API key is public by design; this never leaves your shell.
KEY=$(grep VITE_FIREBASE_API_KEY .env | cut -d= -f2)
curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"someone@example.com","password":"password123","returnSecureToken":true}'
```

**Blocked looks like an error object with no `idToken`** - typically `400` with a message naming the blocking
function. If you get an `idToken` back, the block is not active: check that the function deployed (it is called
`beforeUserCreated`) and that the Identity Platform upgrade went through. Either way, confirm no account appeared
under Authentication → Users.
The emulators cannot check this for us - the Auth emulator does not run blocking triggers - so this one stays a
manual step after each deploy of `functions/`.

## 4. Create the Firestore database

Cloud Firestore → **Create database** → **production mode** (the rules come from this repo, not the console) → pick a
**location**. The location is permanent, so choose it once: `nam5` for a US multi-region, or a single US region near
the station. It is the one decision here that cannot be undone.

## 5. Log in, then deploy the rules, indexes and functions

**First, log the CLI in** - deploys are authenticated, and a fresh machine has no credentials:

```bash
npx firebase login          # opens a browser; --reauth if it is the wrong account
npm --prefix functions install
npm run deploy:firestore
npm run deploy:functions
```

`.firebaserc` already names the project, and both deploys print it as they start ("Deploying to '...'"), so there is
normally no `firebase use` step at all. If you do need to point the directory somewhere else, note that `firebase use
--add` wants a terminal: in a script, a CI job, or an agent's shell it fails with *"Cannot run firebase use --add in
non-interactive mode"*. Use the non-interactive form instead, which needs no prompt:

```bash
npx firebase use fire-clock-76723 --alias default
```

The indexes take a few minutes to build the first time. If a query ever needs an index that is missing, Firestore
reports it in the browser console with a link - but they are all in `firestore.indexes.json`, so that should not
happen.

### If something goes wrong

- **`HTTP Error: 401 ... invalid authentication credentials`** - not logged in. `npx firebase login`.
- **`Error: Too many arguments. Run firebase help deploy`** - something extra reached the command. The npm scripts
  are the command and nothing else; a note appended to one (`... --only firestore:rules # rules + indexes`) is
  passed to firebase as arguments, not ignored. Notes belong in this document, not in `package.json`.
- **`npm warn EBADENGINE ... required: { node: '22' }, current: { node: '25.x' }`** - expected and harmless. The
  `engines` field in `functions/package.json` names the runtime the functions DEPLOY to, and it has to be an exact
  supported version, so it stays `22` even when the machine has a newer Node. Nothing needs changing; the warning
  appears because npm compares the two.
- **`Functions successfully deployed but could not set up cleanup policy in locations us-central1, us-east1`** -
  the deploy worked. This is about the container images behind the functions, which accumulate and cost a few cents
  a month once they are old. The CLI tries to set a clean-up policy itself and failed to, usually for a permissions
  or Artifact Registry API reason on the deploying account. Set it by hand, once per location it named:

  ```bash
  npx firebase functions:artifacts:setpolicy --location us-central1 --days 1 --force
  npx firebase functions:artifacts:setpolicy --location us-east1  --days 1 --force
  ```

  `--days 1` is the CLI's own default: old images are deleted a day after a deploy supersedes them. If you would
  rather keep the images and live with the bill, `--none` opts out and silences the suggestion for good. If the
  manual command fails the same way, the console is the way round it - you are the Owner there, and it is the
  Artifact Registry repository's cleanup policies, one repository per location. **None of this blocks anything else:**
  go on to the Identity Platform upgrade and the self-sign-up check, and come back to it when convenient.

  One thing not to do about it: `firebase deploy --force` silences this too, but `--force` on *deploy* also skips
  the confirmation before deleting functions that are no longer in the source. That is not a trade worth making for
  a container-image suggestion.
- **`npm audit` reports moderate vulnerabilities** - they come in with `firebase-admin`'s dependency tree. `npm
  audit fix` at this level can move dependencies under a Functions runtime, so leave them and read the report if it
  matters.

## 6. Bootstrap the first administrator

**The three documents that describe one member share ONE id, and that id is the member's Auth uid.** Not their
username, not their name: `users/{uid}`, `users_private/{uid}` and `user_settings/{uid}`, where `uid` is the value in
the Authentication → Users table. The security rules compare it to `request.auth.uid` and the app's readers look it
up the same way, so a document filed under a friendly id is a document that nothing can read and no rule will allow.

They are split rather than merged for one reason: **a document is the unit of permission.** The roster row
(`users`) is what everybody can see, `users_private` holds what only the member and their officers may see, and
`user_settings` is the member's own preferences. One document holding all three could only be all-public or
all-private.

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

