*System → Notifications* configures push notifications: telling members about their shifts, and telling approvers about new offers. Three cards, and the first one is administrator-only.

> [!IMPORTANT]
> Maintaining notifications and notification settings requires the **Manage notification settings**.

## Firebase Cloud Messaging

> [!IMPORTANT]
> The **Firebase Cloud Messaging** card requires **Administrator access** to view and edit.

> [!CAUTION]
> Do not change the settings in the FCM card without first consulting Matt!

This card holds what the station's browser needs in order to subscribe. The **sending** half is not here at all: notifications are sent by the deployment's own service account, which nothing on this screen configures and no browser ever holds.

- **Web config** is the Firebase web app configuration and **VAPID public key** is the Web Push certificate key. Both come from the Firebase console — *Project settings → Your apps* for the config, *Cloud Messaging → Web configuration* for the key — and both are **public by design**: they identify the station's app to Google rather than authorising anything. The same values are built into the app when it is deployed, so this card is how a station changes them **without** a rebuild. A value set here takes precedence over the one in the build.
- **There is nothing to paste and no key to store.** Earlier versions of this card took a service-account email and private key so that the old Google Sheet backend could send pushes. That credential is gone, along with the fields: the app's own functions send notifications as themselves, and a private key pasted into a settings document — which is where it used to end up — is a credential sitting somewhere no browser should ever see.
- **Test** is per member, and lives in the **Device Status** table below — see that section. A test that fails is reported with the actual reason: an authorization problem on the server is not the same as a message FCM refused, and the message says which you have. A server-side refusal is fixed in the Google Cloud project rather than on this screen, because the credential is the deployment's own service account.

## Station Defaults

The switches here decide what members receive **by default**. They are defaults rather than overrides: a member can opt in or out for themselves in *User Settings → Notifications*, and their choice wins.

- **New shift requests** — notify approvers when a member offers to fill a shift. It goes to everyone whose role can approve shift requests, which is the same permission as the Pending Approvals tab.
- **Shift offer approved** / **Shift offer declined** — notify the member who made an offer once it is decided. These are the notifications members actually care about, since they are waiting on an answer.

Turning a default off does not stop a member who has explicitly opted in from receiving it.

## Device Status

A per-member table showing, for each person:

| Column | Meaning |
|---|---|
| **Member** | Who the row is about |
| **Device** | How many devices they have registered — a member with a phone and a computer counts twice — or **Off (administrator)** if they have been switched off below |
| **New requests** / **Approved** / **Declined** | Their own notification switches, or *Default* when they have not overridden the station setting |
| **Test** | Sends a test notification to **every** device they have registered |
| **New requests** / **Approved** / **Declined** | Whether that notification would actually reach them, after their own settings and the station defaults are combined |
| **Test** | Sends one test notification to that member's devices |
| **Notifications** | **Turn off** forgets every device that member has and blocks their account; **Turn on** lets them enable devices again |

**Turning a member's notifications off** is for the cases where a member keeps receiving and should not — a device they no longer hold, an account being stood down. It asks first, because it does two things at once:

- **Their devices are forgotten**, so nothing is delivered any more. This includes a device that registered before the device list existed.
- **Their account is blocked**, so it cannot come back by itself. Without this the member's own browser would register itself again the next time they opened *User Settings* — the app re-checks a device every time that page is opened — and the switch would quietly undo itself.

Neither half touches what the member sees **inside** the app: announcements, shift decisions and everything else still work. They are simply not interrupted away from it. The change is written to the **System Log** either way, naming both members — that is where someone whose alerts stopped can find out why, and who decided it.

**Turning them back on** lifts the block only. Their devices stay off until they enable each one again from the device itself, because that is the only place a push subscription can be turned on — a browser cannot be subscribed from the server.

The three notification columns matter because they show the **effective** answer rather than the raw switches: a member who has opted out will read *Off* here even if the station default is on, which is exactly what you want to know when a member says they are not being told about their shifts.

**Use Test on a real member** — it is the only way to prove delivery end to end, and it tells you immediately whether the problem is the configuration or one person's device. The button is disabled for anyone with no registered device, with a tooltip saying so; that alone answers "why is this member getting nothing?".

An amber banner appears when the Firebase configuration is incomplete, because testing before then can only fail.

Each **device** is registered separately, so one member with a phone and a desktop counts twice. Members register themselves in *User Settings → Notifications*; a member who has never done that receives nothing regardless of the defaults.

A device belongs to **one member at a time**. The push subscription belongs to the browser, so a shared station computer can only deliver one member's notifications, and the row naming it is the record of whose. Two members using the same machine therefore need to take it over deliberately, from the button in *User Settings* — signing in changes nothing on its own, which is what stops a login on the office computer from quietly stealing it. Every hand-over is written to the **System Log** (*Moved a device from …*), as is turning off a device that was set up for somebody else, because neither member can see the other's side of it.

## Why nobody is getting notifications

Work through it in this order:

1. **Does the member have a device?** Check the **Device** column. If it reads empty or *none*, they have never enabled notifications — no server setting can change that. If it reads **Off (administrator)**, somebody switched them off deliberately (see **Device Status** above): the System Log says who and when, and **Turn on** in that table is the only way back. If the count has *dropped* since it last worked, suspect a shared computer: another member can only take a device over deliberately, and the System Log says who did it and when.
2. **Is the Firebase configuration complete?** An amber banner in **Device Status** says not.
3. **Did they allow the browser prompt?** A member who dismissed it shows as *blocked* in their own User Settings, and must re-allow it in the browser's site settings.
4. **Does a Test reach them?** Press **Test** on their row. A failure names the cause; a success that does not appear on their device means the problem is on the device, not the server.
5. **Is it an iPhone?** On iOS, notifications only work once the app has been **added to the Home Screen** and opened from that icon. A plain Safari tab cannot subscribe, and no server-side setting changes that.
6. **Is the operating system silencing the browser?** The notification can be delivered and still not appear — check the device's own notification settings for the browser.

> [!NOTE]
> The server cannot distinguish step 6 from a delivery failure, so it is worth ruling out before assuming a configuration problem.
