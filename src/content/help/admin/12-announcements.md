*Content → Announcements* is where you write the messages members see in the app: at the top of the timeclock dashboard, and in the sidebar. Each one can be aimed at everyone, or narrowed to a role, a rank or a single member. (The login screen used to be a third place; it has been removed — see **Where it shows** below.)

> [!IMPORTANT]
> Writing announcements requires the **Make announcements** role permission.

## The fields

Press **New announcement** at the right of the list to add one, or **Edit** on a row. Either opens the editor **over the page**, with Save and Cancel in a bar at the top of it that stays put while the form scrolls, and it closes when the save lands.

| Field | Notes |
|---|---|
| **Title** | Required. Shown in bold at the top of the announcement |
| **Message** | Required. The body text; line breaks are kept as you typed them |
| **Effective Date** | Required. The first day it shows |
| **End Date** | Optional. The last day it shows. Blank runs indefinitely |
| **Color** | Info, Tip, Important, Warning or Caution — the same palette the help guides use |
| **Icon** | Optional. Blank shows an exclamation triangle |

The author is recorded automatically and cannot be changed, so the list always says who wrote what.

## Where it shows

At least one place must be chosen, or the announcement would be saved and never seen.

- **Timeclock dashboard** — above the clock, below the welcome message.
- **Sidebar** — below the name card, above the menu.

> [!IMPORTANT]
> **There is no longer a login-screen placement.** An announcement used to be postable to the login screen, where it could only ever be aimed at everyone: nobody is signed in yet, so a role, a rank or a person cannot be resolved. That made it the one thing the app had to read before anyone signed in, and anything that has to be read at that point belongs in the app's own code rather than in a form. If you were using it for something that genuinely matters — a hall closure, a burn ban — say so and it can be built into the login screen properly. An old announcement that still has the login screen ticked shows now on **neither** screen: open it, tick the dashboard or the sidebar, and save.

> **An announcement arrives as soon as you save it.** The app keeps an eye out for new ones, so a member who is already signed in sees it within moments rather than at their next sign-in — which is what makes an announcement worth writing in a hurry.

## Who it reaches

The three targeting fields are **optional and are read together**: fill in one, two or all three, and a member receives the announcement only if every field you filled matches them. Leave all three blank and everyone gets it.

| Filled in | Reaches |
|---|---|
| Nothing | Everyone |
| Rank: Firefighter | Every Firefighter |
| Rank: Firefighter, Role: Member | Members who are Firefighters |
| Member: Member 4 | Member 4 only |

If the combination matches nobody, the announcement is **refused** rather than saved — a message nobody can receive is a mistake worth catching while you are writing it. The form warns you before you save, and the backend enforces the same rule.

> [!NOTE]
> Two Firefighters with different roles do **not** both match "Rank: Firefighter, Role: Member". The fields narrow the list; they do not widen it. If you want either group, that is two announcements.

## Push notifications

Tick **Also send a push notification** and the announcement also goes to the registered devices of everyone it matches, as well as being visible in the app.

Members can turn announcement pushes off for themselves in *User Settings → Notifications*, and the station default sits beside the other notification switches in *System → Notifications*.

> [!NOTE]
> **Turning the push off never hides the announcement.** The switch is about being interrupted, not about being told: a member who silences announcement pushes still sees every announcement on the dashboard and in the sidebar. Silence the push and the notice is still waiting for them in the app.

The list shows a **Push** badge on announcements sent that way. A member with no registered device simply does not receive the push, which is the same for every notification the app sends. The save reports how many devices it reached, how many had no device, and how many had announcements switched off.

## Dismissing

Tick **Let members dismiss it** and a member can close it; otherwise it stays until it expires. Dismissal is remembered **on that device only**, so a member who dismisses on a phone still sees it on the station terminal. It has no effect on the push notification.

Use dismissal for something a member has read and acted on. Leave it off for anything they may need to refer back to — a drill time, a policy change — because a dismissable announcement is one tap from never being seen again on that device.

## Editing and deleting

Announcements are listed newest first, with a badge saying whether each one is **Showing now** or **Not showing**, who it reaches, where it appears, its dates, and who created it. Edit any of them — including their dates — or delete them. Deleting is permanent, so to retire one you can also just set an **End Date** in the past and keep the record of what was sent.

The list opens on the **last twelve months**, plus **everything still in force** — so a notice with no End Date never falls out of it, however old it is. The line beside the count says which floor you are looking at, and **Show older** moves it back a further year at a time. Reach for it when you are looking for something that has already ended.

> **If a box appears above the list telling you some announcements are not showing to the crew**, those rows were saved before the app recorded an end date for them, so they cannot be read out to members. Open each one, check the dates, and save it: saving marks it, and nothing else about the announcement changes. The box disappears once every row has been saved.

> [!NOTE]
> **Created by** is stamped automatically when an announcement is first saved and cannot be changed afterwards — not by the person who wrote it, and not by an administrator. It appears only in this tab: members never see who wrote an announcement, only the message itself.

> [!TIP]
> To take an announcement down early, edit its **End Date** to yesterday rather than deleting it. The record stays in the list — press **Show older** if it has been down for more than a year — and re-running it later is a single date change.
