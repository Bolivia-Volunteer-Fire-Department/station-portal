*System → System Settings* holds the station-wide configuration. Three of the cards are straightforward; **Clock Location** and **Session Timeout** are the two with real consequences for members.

> [!IMPORTANT]
> You must have the **Manage system settings** role permission to edit system settings.

## General Settings

| Setting | Effect |
|---|---|
| **Department Name** | Shown on the login screen and in the browser tab title |

It is the first thing a member sees, so use the name they would recognise.

## Clock Location

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
- **Saving applies to members who are signed in right now**, not just the next sign-in: the setting is pushed out to open sessions, keeping whatever idle time they have already spent. So shortening it while somebody has been idle for longer than the new value ends their session immediately. Editing the cell directly in the spreadsheet instead reaches only the next sign-in.

> [!WARNING]
> **A value that cannot be read switches this OFF rather than on.** A cell holding `30 minutes` or `1,000` is reported as unusable and the timeout is not applied. This is deliberate: a typo that expired every session instantly would lock the whole department out of a shared terminal, and the card tells you when it is happening.

Setting this very low — a minute or two — will sign members out while they are reading a long help guide without touching anything. Fifteen to sixty minutes is the useful range for a station terminal.

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

All ten fields are always there, whether or not a message has been set, so the first one can be added from this screen rather than by inserting a row in the sheet. Saving writes all ten: clearing a field removes that message, and an empty field stays empty.

## Custom Settings

Any other `key`/`value` pairs on the `system_settings` sheet, listed here so you can see and edit them without opening the spreadsheet. The three clock-location keys and everything in the cards above are managed by their own cards and are deliberately not duplicated here.

Credential-looking keys — anything named like a password, secret or private key — are excluded from what the app sends to browsers, so they will not appear in this list at all. Those are configuration for the server, not settings for the app.
