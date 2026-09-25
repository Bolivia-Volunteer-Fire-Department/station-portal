*System → Notifications* configures push notifications: telling members about their shifts, and telling approvers about new offers. Three cards, and the first one is administrator-only.

> [!IMPORTANT]
> Maintaining notifications and notification settings requires the **Manage notification settings**.


## Firebase Cloud Messaging

> [!IMPORTANT]
> The **Firebase Cloud Messaging** card requires **Administrator access** to view and edit.

> [!CAUTION]
> Do not change the settings in the FCM card without first consulting Matt!

This card holds the credentials that let the station's server send notifications at all. Until it is filled in correctly, no notification can be delivered however the other cards are set.

- **Project ID**, **Client email** and **Private key** come from a Firebase service account, and the web configuration keys come from the Firebase web app registration. The repository's `docs/FCM_SETUP.md` walks through creating them, and is worth reading in full before starting — the private key in particular is easy to paste incorrectly.
- **The private key is write-only.** Once stored it is never sent back to a browser, not even to an administrator: the card reports only whether a key is present. Leaving the field **blank on save means "keep the existing key"**, not "clear it", so you can change another field without re-pasting it.
- **Test** is per member, and lives in the **Device Status** table below — see that section. A test that fails is reported with the actual reason: an authorization problem on the server is not the same as a message FCM refused, and the message says which you have. If the report mentions an external-request permission, the Apps Script project needs re-authorizing; the setup guide in `docs/FCM_SETUP.md` covers that.


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
| **Device** | Whether they have a registered device |
| **New requests** / **Approved** / **Declined** | Whether that notification would actually reach them, after their own settings and the station defaults are combined |
| **Test** | Sends one test notification to that member's devices |

The three notification columns matter because they show the **effective** answer rather than the raw switches: a member who has opted out will read *Off* here even if the station default is on, which is exactly what you want to know when a member says they are not being told about their shifts.

**Use Test on a real member** — it is the only way to prove delivery end to end, and it tells you immediately whether the problem is the configuration or one person's device. The button is disabled for anyone with no registered device, with a tooltip saying so; that alone answers "why is this member getting nothing?".

An amber banner appears when the Firebase configuration is incomplete, because testing before then can only fail.

Each **device** is registered separately, so one member with a phone and a desktop counts twice. Members register themselves in *User Settings → Notifications*; a member who has never done that receives nothing regardless of the defaults.


## Why nobody is getting notifications

Work through it in this order:

1. **Does the member have a device?** Check the **Device** column. If it reads empty or *none*, they have never enabled notifications — no server setting can change that.
2. **Is the Firebase configuration complete?** An amber banner in **Device Status** says not.
3. **Did they allow the browser prompt?** A member who dismissed it shows as *blocked* in their own User Settings, and must re-allow it in the browser's site settings.
4. **Does a Test reach them?** Press **Test** on their row. A failure names the cause; a success that does not appear on their device means the problem is on the device, not the server.
5. **Is it an iPhone?** On iOS, notifications only work once the app has been **added to the Home Screen** and opened from that icon. A plain Safari tab cannot subscribe, and no server-side setting changes that.
6. **Is the operating system silencing the browser?** The notification can be delivered and still not appear — check the device's own notification settings for the browser.

> [!NOTE]
> The server cannot distinguish step 6 from a delivery failure, so it is worth ruling out before assuming a configuration problem.
