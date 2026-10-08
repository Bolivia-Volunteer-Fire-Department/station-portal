*System → System Settings* holds the station-wide configuration. **Clock Settings**, **Session Timeout**, the **Training Signing Window** and the **Pay Period** are the cards with real consequences for members; the rest are cosmetic or one-off values.

> [!IMPORTANT]
> You must have the **Manage system settings** role permission to edit system settings.

## General Settings

| Setting | Effect |
|---|---|
| **Department Name** | Shown on the login screen and in the browser tab title |

It is the first thing a member sees, so use the name they would recognize.

## Clock Settings

Two station-wide policies about the timeclock, in one card: **how reported hours are rounded**, and **whether clocking in and out is restricted to the station**.

### Round reported hours

| Choice | What it does |
|---|---|
| **Nearest 15 minutes** | 14.75 hrs stays 14.75; 14.8 becomes 15.00 |
| **Nearest 30 minutes** | 14.75 becomes 15.00; 14.25 becomes 14.50 |
| **Nearest hour** | 14.75 becomes 15.00; 14.25 becomes 14.00 |

This is the station's pay structure, so it is used in **two** places and they always agree:

- Every hour on a member's own **Clock History** — each entry's duration, the shift it fell in, and the totals at the top.
- The **Clocked vs scheduled** report an officer reconciles against, where each shift's clocked hours are rounded before the difference is worked out.

The default is **Nearest 15 minutes**, which is the finest step, so a station that has never chosen rounds as little as possible. Change it whenever the pay structure changes — **no recorded time is ever altered**, only the hours the app reports. The exact timestamps stay on every entry, so moving to a coarser step (or back) is always available.

### Clock-in location

An optional check that restricts clocking in and out to the station, within a radius you choose.

| Field | Notes |
|---|---|
| **Latitude** | Station latitude, decimal degrees |
| **Longitude** | Station longitude, decimal degrees |
| **Margin (feet)** | How far from the station a clock action is still accepted, in **feet** |

**It is all three or nothing.** Unless every field holds a valid value the check is switched off and clocking behaves exactly as it always has — so a half-finished setup can never lock the station out of its own timeclock. The card says which state it is in: **Enforcing** or **Not enforced**, and names any field that is still blank or unreadable.

When it is enforcing:

- A clock action from **beyond the margin** is rejected, and the member is told how far away they are and what the limit is.
- A clock action with **no location at all** is rejected, including when the member has declined the location prompt. That is what stops the check being avoided by simply saying no.
- The rejection happens **before anything is written**, so a rejected action leaves no entry in Clock Management for you to clean up.

Two things worth knowing before switching it on:

1. **Use "Use my current location"** — it fills in the latitude and longitude from the device you are using. Standing at the station and pressing that button is far more reliable than typing coordinates from a map.
2. **A margin in feet is small.** A GPS fix indoors can be off by more than you expect, and a generous margin is kinder than a precise one. If members start reporting rejections near the boundary, widen the margin rather than asking them to retry.

Because the check applies to clocking **out** as well as in, a member who drives away mid-shift cannot close their entry from home. Correct it in **Clock Management** if that happens.

Values are read strictly: `1,000` with a comma, or `1000ft`, are treated as unreadable and the check switches **off** rather than guessing. Enter plain decimals — `1000`.

## Session Timeout

Signs a member out of a shared terminal when nobody is using it. The card's badge reads **Enforcing** when it is active and **Not enforced** when it is not.

| Value | Effect |
|---|---|
| **Blank** | No idle timeout — sessions last 12 hours, as before |
| **A whole number of minutes** (e.g. `30`) | A member who neither interacts nor moves between modules for that long is signed out |

**What counts as activity:** a click, a keypress, a scroll, a touch — or moving between modules. That covers both halves of "did not save something or navigate somewhere": interacting with the app at all, and getting on with the job elsewhere in it.

**The timer only runs while somebody is signed in**, and it resets the moment they interact, so a member working steadily is never interrupted. In the final minute they see a warning with **Stay signed in** and **Sign out now**; if they ignore it, the session ends.

Two details worth knowing before you set this:

- **The server expires the session as well, not just the browser.** A session that has been idle for longer than the setting stops working on the server too, so the timeout holds even if someone keeps the page open — the browser half is the courtesy, the server half is the rule.
- **Saving reaches members who are signed in right now**, not just the next sign-in: the app keeps an eye on this setting, so an open session picks up a change within moments and keeps whatever idle time it has already spent. Shortening the time-out while somebody has been idle for longer than the new value therefore ends that session straight away rather than at the next sign-in.

> [!WARNING]
> **A value that cannot be read switches this OFF rather than on.** A cell holding `30 minutes` or `1,000` is reported as unusable and the timeout is not applied. This is deliberate: a typo that expired every session instantly would lock the whole department out of a shared terminal, and the card tells you when it is happening.

Setting this very low — a minute or two — will sign members out while they are reading a long help guide without touching anything. Fifteen to sixty minutes is the useful range for a station terminal.

## Training Signing Window

How long after its date a training stays open for signatures. The badge reads the number of days when a window is set, and **No limit** when none is.

| Value | Effect |
|---|---|
| **Blank** | No window — a training can be signed for as long as it exists |
| **A whole number of days** (e.g. `30`) | Signing closes after the 30th day past the training's date, counting that date itself |

The window is counted from **each training's own date**, so one number covers every training at once: there is nothing to set per training, and nothing to remember when one is added.

**Two separate things close a training for signature:**

- **the window**, once that many days have passed, and
- **the external-system marker**, immediately and whatever the date — that marker is an administrator saying "this record is finished", which no date can express (see **Training**).

A closed training shows the member a **Closed** button whose tooltip says which of the two applies, and a line above the list states the window in days. **Signatures already given are untouched**: closing the window stops new ones, and removing one stays an administrator's action in the Training report.

> [!NOTE]
> A value the app cannot read — `3O`, `30 days`, a negative number — is **ignored rather than applied**, so a typo cannot close every training in the station at once. The card says so while you type it.

> [!IMPORTANT]
> A member cannot sign on an administrator's behalf and an administrator cannot sign for them, so a signature that is genuinely missing is fixed from this card: widen the window, have them sign, and set it back. Nothing about the window is retroactive.

Set this if members tend to sign in bulk, months later. A signature is an acknowledgment of attendance, and one given six months afterwards is worth much less to the record it lands in.

## Pay Period

How long a pay period covers, and the day it begins on.

| Value | Effect |
|---|---|
| **Days in a pay period** | **This is the Clock History's window**: it opens on the last N days, including today, and **Load older entries** walks back one period at a time |
| **First day of the pay week** | **Every month calendar in the app starts its week on it** — the schedule, the officer's board, both month pickers, the availability grid and the printed sheet. The reports that will total by pay period will read the same field |

The number is not cosmetic. The clock history is the largest read in the app and it grows on its own, because every clock-in and clock-out is a row that stays for good — so a longer period is paid by **every officer on every visit**. Nothing is hidden by a shorter one: the table says what it holds (*entries back to …*) and the button fetches the rest on demand, which is also how an officer asks for more before exporting a CSV.

> [!NOTE]
> A length the app cannot read — `7O`, `fortnight`, `0` — is **ignored rather than applied**, so a typo cannot collapse the window onto a single day or widen it to the whole history. The card says so while you type it.

## Display Settings

| Setting | Effect |
|---|---|
| **Time Format** | The station default, 12-hour or 24-hour |
| **Dark Mode** | The default theme for members who have not chosen one |

Both are **defaults, not overrides**: each member can set their own in User Settings, and their choice wins. Change these to set what a new member gets, not to force a change on existing ones.

## Sound Settings

| Setting | Effect |
|---|---|
| **Sound Effects** | The station default for interface sounds — clicks, popups, toasts and the chime for a push that lands while the app is open |

Like the display settings, this is a **default, not an override**: a member can turn sounds off for themselves in User Settings and their choice wins. It starts **on**, so a station that never touches this card has a fully audible interface.

Two things it deliberately does **not** reach:

- **The Firefighter Runner** keeps its own sound effects either way. The switch is about the interface, not the minigame.
- **A push notification's own alert** is played by the member's device, so nobody can silence it from here — turning sounds off only stops the *in-app* chime.

Worth knowing if a member reports "the app has gone quiet": a member who has never changed the switch follows this card, so turning it off here silences every one of them who has not made their own choice.

## Loading Messages

The rotating messages shown on the loading screen while the app fetches data. Ten of them, and you can edit any or all. Short works best — they are read in passing during a wait of a few seconds.

All ten fields are always there, whether or not a message has been set, so the first one can be added from this screen rather than by adding a row by hand. Saving writes all ten: clearing a field removes that message, and an empty field stays empty.

## Custom Settings

Any other settings the station has stored, listed here so you can see and edit them without going anywhere else. The three clock-location keys and everything in the cards above are managed by their own cards and are deliberately not duplicated here.

Credential-looking keys — anything named like a password, secret or private key — are excluded from what the app sends to browsers, so they will not appear in this list at all. Those are configuration for the server, not settings for the app.
