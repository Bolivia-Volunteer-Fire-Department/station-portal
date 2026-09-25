*Scheduling → Schedule Templates* is a recurring weekly shift pattern: "every Monday at 08:00, for ten hours, Engine 1". The schedule board then places that pattern on real dates.

> [!IMPORTANT]
> Editing schedule templates requires the **Manage schedule templates** role permission.

## The fields

| Field | Notes |
|---|---|
| **Day of Week** | Which day of the week the shift recurs on |
| **Start Time** | When it begins |
| **End Time** | When it ends |
| **Assignment** | What the shift is — sets its color, icon and minimum rank |
| **Nickname** | Optional label, such as "Day Shift" |
| **Effective Date** | **Required.** The first date it runs |
| **End Date** | Optional. The last date it runs. Blank means it is still running |

## Effective and end dates

The **Effective Date** is required: every template says when it started, so a pattern can be understood later. It is the first date the template runs.

The **End Date** lets you **retire a pattern without deleting it**. Deleting a template erases the record of what the station used to run, so a template that is being replaced should be given an **End Date** and left alone. The schedule history stays intact, and you can always see what was running when.

- A template outside its dates **produces no shifts**. It disappears from the member's calendar, from the **Schedule Management** board, from the Add Shift picker and from the availability screens at the same time.
- **Both dates are inclusive.** A template effective July 1 runs *on* July 1, and one ending June 30 is still running *on* June 30.
- **An optional end date means no end.** Leave **End Date** blank and the pattern keeps running indefinitely; set it and the pattern stops after that day.
- The end date **must not be before** the effective date, and the two may be the same day for a pattern that ran once.

Switching patterns is the usual case: give the outgoing template an end date of, say, June 30, and the incoming one an effective date of July 1. The week grid then shows both, and the board draws the handover on the right days without any shifts being deleted or re-entered.

> [!NOTE]
> The week grid always draws every template, including retired ones, so you can still edit or delete them — a retired card is simply dimmed and labeled with its window. On the board and the calendars, retired templates produce nothing at all.

> [!IMPORTANT]
> Templates created before the effective date was required still have a blank cell, and **keep working** — a blank cell is read as "no start date" rather than as an error, because treating it as one would remove those templates from the schedule at once. They show **⚠ No start date** on the week grid, and giving one a date the next time you edit it clears the warning.

## The week grid

The grid shows all seven days with the templates that fall on each, ordered by start time. Cards show the nickname if there is one and the assignment name underneath, so a week reads at a glance.

**Drag a card to another day to move it.** The position you drop it on sets the new start time in fifteen-minute steps, so dragging is often quicker than typing.

> [!NOTE]
> Dragging a card sideways changes the day, dragging it up or down changes the time.

## Nicknames

A nickname replaces the times as the label everywhere that shift is drawn — the member's calendar, the administrator's board, the availability screens and the template grid. Leave it blank and the times are shown instead.

Use it where the times are obvious to everyone and a name is clearer: *Day Shift*, *Night Shift*, *Training Night*. The exact times are never lost — hovering a shift still shows the full window, and the schedule details list spells them out.

Nicknames are per **template**, so every Monday 08:00 shift carries the same one.

## Times and midnight

A template's end time must be later than its start time on the same day. For a shift that runs past midnight, that means the template covers the two days — and on the calendars the shift is drawn **on the day it starts**, so an overnight shift appears once in the right place rather than on both days.

## Custom shifts are not templates

A one-off shift that does not repeat belongs on the **Schedule Management** board, not here. Templates are for the pattern; the board is for the exceptions, and a custom shift there is created with **Add Shift** rather than by adding a template you would then have to delete.

## Checking your work

After saving, look at **Schedule Management** and step through the next week or two. The board draws the real result, slot by slot, which is the fastest way to spot a template on the wrong day or with the wrong assignment. Anything the pattern gets wrong can be corrected for that date alone on the board without touching the template.

When you set a date on a template, step across the boundary in the board's month arrows — the last day it runs and the first day it does not — to confirm the handover lands where you intended.
