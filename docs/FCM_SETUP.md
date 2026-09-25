# Push Notifications (Firebase Cloud Messaging)

Station Portal sends shift notifications to members' devices through
**Firebase Cloud Messaging (FCM)**. This guide covers the one-time Firebase
setup, the values to paste into the app, and how to test delivery.

Everything below is configured from the app - no rebuild or redeploy is needed
after the first deployment:

**Administration → System → Notifications** (FCM credentials + station defaults)
**User Settings → Shift Notifications** (per-device opt-in + per-type toggles)

---

## 1. How it fits together

| Piece | Where it lives | Job |
|---|---|---|
| Firebase web config, VAPID public key | `system_settings` sheet (`fcm_web_config`, `fcm_vapid_public_key`) | Lets a member's browser register for push |
| Service account email + private key | `system_settings` sheet (`fcm_service_account_*`) | Lets the Apps Script backend *send* push |
| Device token + opt-in toggles | `user_settings` sheet (`fcm_token`, `notify_*`) | Per-device registration and preferences |
| Service worker | `public/sw.js` (built to `/sw.js`) | Receives messages, shows notifications, focuses the app on click |
| Sender | `src/services/Code.gs` → `sendShiftOfferPush()` | Fires on every shift-offer change |

Notifications are sent by the backend whenever `notifyShiftOffer()` runs, which
is every shift-offer state change:

| Event | Who is notified | Opt-in key |
|---|---|---|
| A member offers to take an open shift | All admins | `notify_new_offer` |
| An admin approves the offer | The member who offered | `notify_offer_approved` |
| An admin declines the offer | The member who offered | `notify_offer_declined` |

Members never install anything: opening the app and pressing **Enable** in
User Settings is enough.

---

## 2. Create the Firebase project

1. Open the [Firebase console](https://console.firebase.google.com/) and choose
   **Add project**. Give it a name (for example `station-portal`) and finish the
   wizard. Google Analytics is not required.
2. In the project, click the **web** icon (`</>`) on the project overview to add
   a web app. Nickname it (for example `Station Portal`) - **do not** tick
   Firebase Hosting; the app is served elsewhere.
3. Firebase shows an `firebaseConfig` object:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "station-portal.firebaseapp.com",
     projectId: "station-portal",
     storageBucket: "station-portal.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef123456"
   };
   ```

   Keep this window (or copy the JSON) - it is the **web config** from step 5.

   > These are illustrative values. What matters is that the three strings you paste into the app match the
   > project you actually created - the project id, and the `authDomain` / `storageBucket` derived from it.
   > (The Firebase project behind this deployment happens to be named `fire-clock-76723`; a Firebase project
   > name is independent of the app's own name and cannot be changed after creation.)
4. Go to **Build → Cloud Messaging** and confirm that Cloud Messaging shows as
   enabled (it is part of the default project setup).

---

## 3. Create the Web Push certificate (VAPID key)

Browsers refuse push subscriptions without a VAPID key pair.

1. **Project settings** (gear icon) → **Cloud Messaging** tab.
2. Scroll to **Web Push certificates** and click **Generate key pair**.
3. Copy the key string (it starts with `B...`). This is the
   **VAPID public key** from step 5.
   - There is no private key to copy: Firebase keeps it and uses it when your
     backend sends messages.

---

## 4. Create the service account (server-side sender)

The Apps Script backend signs a JWT with a service account to call the FCM HTTP
v1 API.

1. **Project settings** → **Service accounts** tab.
2. Click **Generate new private key** → **Generate key**. A JSON file
   downloads - keep it private.
3. Open the JSON file and note two fields:
   - `client_email` - for example
     `firebase-adminsdk-abc12@your-project.iam.gserviceaccount.com`
   - `private_key` - the long `-----BEGIN PRIVATE KEY-----` block

---

## 5. Authorize the script (one time)

Apps Script works out which permissions a script needs by **scanning its code**.
The notification backend calls `UrlFetchApp` to reach Google's servers, which
requires this OAuth scope:

```
https://www.googleapis.com/auth/script.external_request
```

If the Apps Script project was authorized *before* the notification code was
added, that earlier grant does not include the new scope, and the admin **Send**
test fails with:

```
Exception: You do not have permission to call UrlFetchApp.fetch.
Required permissions: https://www.googleapis.com/auth/script.external_request
```

That is **not** a trigger problem - triggers only schedule when functions run and
have nothing to do with this error.

To grant the scope:

1. Open the Apps Script project (**Extensions → Apps Script** from the sheet).
2. In the function dropdown at the top of the editor, select
   **`diagnoseFcmSetup`** and press **Run**.
3. Google shows *"Authorization required"*. Click **Review permissions**, pick
   your account, then **Allow**. The dialog mentions connecting to an external
   service.
4. If a *"Google hasn't verified this app"* warning appears, use
   **Advanced → Go to \<project\> (unsafe)**. That is expected for a private,
   unpublished script.
5. The **Execution log** now prints a checklist. Work through any `[FAIL]` lines
   before testing.
6. **Publish the code to the live web app:** `Deploy → Manage deployments →
   Edit (pencil) → Version: New version → Deploy`. A deployment is pinned to a
   version, so the running web app only picks up the grant once a new version is
   deployed.

Then press **Send** again on the admin Notifications tab.

> **If no consent dialog appears and step 5 still reports
> `[FAIL] external requests`:** this is the case where nothing prompts you, so
> there is nothing to accept. Pick either route.
>
> **Route A - revoke, then re-run (no manifest edit).**
> A previously authorized project keeps its old token, and an old token can
> suppress the consent screen. Remove that token so Google has to ask again:
> open <https://myaccount.google.com/permissions>, find this Apps Script project,
> choose **Remove access**, then run `diagnoseFcmSetup` again. The consent dialog
> should now appear - accept it and continue with steps 5-6.
>
> **Route B - pin the scopes in the manifest (deterministic).**
> Open **Project Settings**, tick *"Show `appsscript.json` manifest file in
> editor"*, then add an `oauthScopes` array. These two are **every** scope this
> project needs:
>
> ```json
> {
>   "timeZone": "America/New_York",
>   "dependencies": {},
>   "exceptionLogging": "STACKDRIVER",
>   "runtimeVersion": "V8",
>   "oauthScopes": [
>     "https://www.googleapis.com/auth/spreadsheets",
>     "https://www.googleapis.com/auth/script.external_request"
>   ],
>   "webapp": {
>     "executeAs": "USER_DEPLOYING",
>     "access": "ANYONE_ANONYMOUS"
>   }
> }
> ```
>
> Save, run `diagnoseFcmSetup`, accept the consent dialog, then deploy a new
> version. Adding `oauthScopes` switches automatic scope detection **off** for
> good, so the list has to stay complete: if a later change starts using a new
> Google service, its scope must be added here or that call fails with
> *"Specified permissions are not sufficient to call …"*.
>
> Where those two scopes come from: `SpreadsheetApp` needs `spreadsheets`, and
> every `UrlFetchApp` call needs `script.external_request`. Nothing else in
> `Code.gs` requires a scope - `Utilities`, `PropertiesService`, `CacheService`
> and `LockService` are unscoped, and `Session.*` is never called.

---

## 6. Paste the values into Station Portal

Sign in as an administrator and open
**Administration → System → Notifications**.

| Field in the app | Paste this | Where it comes from |
|---|---|---|
| Firebase web config (JSON) | The whole `firebaseConfig` object from step 2 | Firebase web app setup |
| VAPID public key | The `B...` key from step 3 | Web Push certificates |
| Service account email | `client_email` from step 4 | Service account JSON |
| Service account private key | `private_key` from step 4 | Service account JSON |

Press **Save FCM Configuration**. The card turns green and the header shows
"Firebase Cloud Messaging is configured" once all four values are stored.

> The web config can be pasted exactly as Firebase shows it, including the
> `const firebaseConfig = { ... };` wrapper - only the JSON object between the
> braces is read.

Then, under **Station Defaults** on the same screen, choose what everyone is
notified about. Members can override these individually; leaving a member's
setting blank means "use the station default".

---

## 7. Members opt in on each device

Notifications are per device and per browser profile.

1. Sign in and open **User Settings → Shift Notifications**.
2. Press **Enable** next to *This device* and accept the browser permission
   prompt (the prompt only appears from that click).
3. The card then reads "Registered for push notifications."

On iPhone/iPad, notifications only work after the app is **added to the Home
Screen** (Safari → Share → *Add to Home Screen*) and opened from that icon -
this is an Apple platform requirement, not a Station Portal one.

Each additional device repeats step 2; every device gets its own token. Press
**Turn off** to revoke just that device.

### Where notifications actually arrive

Once a device is registered, delivery does **not** depend on the app being open.
FCM hands the message to the browser's (or OS's) push service, which wakes the
service worker in the background and displays the notification - so a member gets
shift updates with the tab closed or the app not launched. What each platform
requires first:

| Platform | Requirement for push to work |
|---|---|
| Android (Chrome/Edge) | None beyond the in-app **Enable**. Installing to the Home Screen is optional but gives a standalone window. |
| iPhone/iPad (Safari) | **iOS/iPadOS 16.4+**, and the app must be **added to the Home Screen** (Share → *Add to Home Screen*) and opened from that icon. Push does **not** work from a normal Safari tab, and `display: standalone` in `public/manifest.webmanifest` is what makes it install as a web app rather than a bookmark. |
| macOS (Chrome/Safari) | Browser must be running. See the OS-notification note in **step 9** - Chrome on macOS needs *Google Chrome Helper* alerts allowed or nothing is drawn. |
| Desktop, app open | Also shows an in-app toast, so the message is visible even when the OS suppresses the banner. |

Two consequences worth knowing:

- **iOS needs the manifest.** Without a `manifest.webmanifest` declaring
  `display: standalone`, iOS saves the site as a plain Home Screen *bookmark*,
  and a bookmark cannot receive push. The file is committed; don't remove it.
- **One device per browser profile.** The same person on a phone and a laptop is
  two tokens; enabling on one does not enable the other.

---

## 8. Test delivery

Back in **Administration → System → Notifications**, the **Device Status** table
lists every member with:

- **Device** - `Registered` once a device has been enabled
- **New requests / Approved / Declined** - the member's own setting, or
  `Default` when they inherit the station default
- **Send** - pushes a test notification to that member's registered device

If the test arrives, real shift notifications will too. To test end to end,
have a member offer to take an open shift (admins get "New shift request"), then
approve or decline it (the member gets the outcome).

If anything fails, run **`diagnoseFcmSetup`** in the Apps Script editor - it
prints a `[ok]` / `[FAIL]` checklist covering authorization, configuration,
the service account and registered devices, so you do not have to guess which
layer is broken.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Push notifications have not been configured by an admin yet." | One of the four values in step 6 is missing. |
| **Enable** does nothing | The browser has notifications blocked for the site. Unblock in the address-bar/site settings, then reload. |
| `Firebase did not return a device token` | The VAPID key or web config is wrong or from a different Firebase project. Re-copy both. |
| `Could not send the test message` + "not yet authorized to make external requests" | The script lacks the `script.external_request` scope. See **step 5** - run `diagnoseFcmSetup` from the editor, accept the prompt, then deploy a new version. |
| `Exception: You do not have permission to call UrlFetchApp.fetch` | Same as above: the authorization was granted before the notification code existed. Not a trigger problem. |
| `FCM rejected the test message (404)` | The device token was revoked (app data cleared, browser reinstalled). The backend clears it automatically; press **Enable** again on that device. |
| Test message succeeds but nothing appears | The service worker must call `showNotification()`. Check its console for `[sw] push received` (see the note below). Also confirm the device hasn't opted out and that OS focus/Do Not Disturb isn't suppressing alerts. |
| `[sw] push received` **and** `[sw] notification displayed` logged, but no banner appears on macOS | The OS is dropping it. Chrome renders web notifications through a separate process, so **System Settings → Notifications → "Google Chrome Helper"** (may appear as **"Google Chrome Helper (Alerts)"**) must have *Allow Notifications* switched on - enabling only "Google Chrome" is not enough. |
| `The script has an unsupported MIME type ('text/html')` + `deleteToken failed` | This came from a previous build that called the FCM SDK's `deleteToken()`. It has no `serviceWorkerRegistration` option (unlike `getToken`), so it looked for a `firebase-messaging-sw.js` that this app doesn't ship. **Harmless** - the device was still deregistered. Current builds don't call it. |
| `FCM auth failed (400/403)` | The service account private key is incomplete (it must include both BEGIN and END lines) or belongs to another project. |
| Notifications stopped after a long break | FCM tokens expire; have the member re-enable the device. Stale tokens reported by FCM are cleared by the backend automatically. |
| Nothing at all, and the Apps Script log is empty | The script may not have been redeployed since notifications were added - deploy a new version of `Code.gs`. |
| Consent dialog never appears on **Run**, so there is nothing to accept | An old, still-valid token suppresses the prompt. Revoke access at <https://myaccount.google.com/permissions> and run again - or pin `oauthScopes` in the manifest. Both routes are in the note at the end of **step 5**. |

Logs: Apps Script editor → **Executions** (per-call errors) and the
`system_log` sheet (`PUSH_SHIFT_OFFER_<EVENT>` rows record how many devices were
reached).

### Why the service worker must display the message itself

FCM accepts a message, and the browser then dispatches a `push` event to
`public/sw.js`. **Only a `showNotification()` call inside that worker puts a
notification on screen.** FCM's own `notification` block in the message is not
rendered for you, and if the worker doesn't display anything Chrome falls back to
a generic *"This site has been updated in the background"* notice instead of your
title and body. `public/sw.js` therefore always calls `showNotification()`,
reading the title/body from `data` (falling back to the `notification` block).

To confirm a message actually reached the worker:

1. Open the app, then DevTools → **Application → Service Workers**.
2. Click the **`sw.js`** entry, then the **console** link for that worker (or pick
   it in the console's context dropdown).
3. Press **Send** in the admin tab and watch for:

   ```
   [sw] push received: Station Portal test {event: 'TEST', ...}
   [sw] notification displayed: TEST:
   ```

`[sw] push received` but no notification means the OS or browser suppressed it
(focus assist / Do Not Disturb, or notifications muted for the site).
No `[sw] push received` at all means the message never reached this device -
check the device token and try re-enabling the device in User Settings.

Service workers update on the next navigation, so after changing `sw.js` reload
the app twice (or use **Application → Service Workers → Update**) before
retesting. The running worker version is available by sending it the
`GET_SW_VERSION` message.

### Desktop platforms can drop the notification after it is shown

On macOS, Chrome hands web notifications to the system Notification Center
through a **separate helper process**, and macOS gates that process
independently of the site permission. The symptom is distinctive: the push
arrives, `showNotification()` resolves successfully, DevTools logs both
`[sw] push received` and `[sw] notification displayed`, and **nothing is drawn**.

Check, in this order:

1. **System Settings → Notifications → "Google Chrome Helper"** - switch on
   *Allow Notifications*. On some macOS versions this entry is named
   **"Google Chrome Helper (Alerts)"**, and on others it is nested under the
   Chrome entry. Enabling **Google Chrome** alone is *not* sufficient; the helper
   is the piece that draws site notifications. If neither entry exists, trigger a
   notification once and reopen the pane so macOS registers the app.
2. **Alert style** for that entry must not be **None** - use *Banners* or
   *Alerts*.
3. **System Settings → Focus** - a Focus/Do Not Disturb mode (including
   scheduled ones) suppresses banners without any error.
4. Notification Center itself: pull it down to confirm the notification was
   filed but not banner-ed (Chrome may be delivering while banners are
   suppressed).

Windows has a comparable gate: **Settings → System → Notifications →
Google Chrome** must be on, and *Focus assist* must not be suppressing.

To make this easier to diagnose, the app shows the **Browser permission** state
in *User Settings → Shift Notifications* (a grant that already exists means
Chrome will not prompt again), and displays every push as an **in-app toast** as
well - so a member with the app open sees the message even while the OS is
silently dropping the banner.

---

## 10. Security notes

- The **service account private key** is a credential. It is stored in the
  `system_settings` sheet, which is only readable by admins through the app -
  keep the sheet itself private and never commit it.
- The web config and VAPID **public** key are not secrets; browsers see them by
  design.
- Notifications are driven entirely by the backend. The client cannot ask the
  server to notify an arbitrary member, and offer notifications are only sent to
  admins (new requests) or to the member who made the offer (decisions).
