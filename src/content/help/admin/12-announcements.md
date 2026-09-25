*Content → Announcements* is where you write the messages members see in the app: on the login screen, at the top of the timeclock dashboard, and in the sidebar. Each one can be aimed at everyone, or narrowed to a role, a rank or a single member.

> [!IMPORTANT]
> Writing announcements requires the **Make announcements** role permission.

## The fields

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

- **Login screen** — directly beneath *"Please login to continue"*.
- **Timeclock dashboard** — above the clock, below the welcome message.
- **Sidebar** — below the name card, above the menu.

> [!IMPORTANT]
> **The login screen only ever carries announcements aimed at everyone.** At that point nobody is signed in, so a role, rank or member target cannot be resolved — and showing a targeted message anyway would put it in front of whoever is standing at the keyboard. Targeted announcements reach their reader once they are signed in, on the dashboard and in the sidebar.

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
> **Turning the push off never hides the announcement.** The switch is about being interrupted, not about being told: a member who silences announcement pushes still sees every announcement on the dashboard, in the sidebar and on the login screen. Silence the push and the notice is still waiting for them in the app.

The list shows a **Push** badge on announcements sent that way. A member with no registered device simply does not receive the push, which is the same for every notification the app sends. The save reports how many devices it reached, how many had no device, and how many had announcements switched off.

## Dismissing

Tick **Let members dismiss it** and a member can close it; otherwise it stays until it expires. Dismissal is remembered **on that device only**, so a member who dismisses on a phone still sees it on the station terminal. It has no effect on the push notification.

Use dismissal for something a member has read and acted on. Leave it off for anything they may need to refer back to — a drill time, a policy change — because a dismissable announcement is one tap from never being seen again on that device.

## Editing and deleting

Announcements are listed newest first, with a badge saying whether each one is **Showing now** or **Not showing**, who it reaches, where it appears, its dates, and who created it. Edit any of them — including their dates — or delete them. Deleting is permanent, so to retire one you can also just set an **End Date** in the past and keep the record of what was sent.

> [!NOTE]
> **Created by** is stamped automatically when an announcement is first saved and cannot be changed afterwards — not by the person who wrote it, and not by an administrator. It appears only in this tab: members never see who wrote an announcement, only the message itself.

> [!TIP]
> To take an announcement down early, edit its **End Date** to yesterday rather than deleting it. The list keeps the history, and re-running it later is a single date change.
