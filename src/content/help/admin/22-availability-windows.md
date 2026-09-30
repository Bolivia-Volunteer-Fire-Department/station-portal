# Availability Windows

*Scheduling → Availability Windows* is where you define the **weekly patterns members can mark themselves available for**. Until at least one window exists, members have nothing to choose from.

A window is a recurring weekly block of time with a name:

- **Nickname** — what a member sees on the pill in their own calendar. Keep it short: it has to fit in a day cell.
- **Starts** and **Ends** — the hours the window covers.
- **Days** — tick every day the window runs on.
- **Effective date** and **End date** — when this *configuration* is in force.

> [!IMPORTANT]
> **The day a window is ticked for is the day it starts, not the day it ends.** A window that runs 18:00 to 08:00 and is ticked for **Tuesday** is a Tuesday night: it finishes on Wednesday morning, and it belongs to Tuesday. That is why it appears on Tuesday's cell and nowhere else.

## Effective and end dates are the window's life, not one occurrence

A window is not a single shift — it happens every week until you stop it. The two dates say when the configuration applies:

- Leave the **end date blank** while the window is current. It keeps applying every week.
- When the station's shift structure changes, set an **end date** on the windows that no longer apply and add the new ones with an **effective date**. Both ends are inclusive.

**Retire windows rather than deleting them.** Members' choices point at a window, so ending it keeps last year's availability readable — "who was available for Tuesday nights in March" still answers. Deleting a window leaves those choices behind with nothing to explain them, which is why the app asks you to confirm it and suggests retiring instead. The list shows **In force** or **Retired** on every row so you can see at a glance which is which.

## What members do with them

Windows are the *options list*, not the answer. A member still marks themselves available **day by day**, exactly as they always have — they simply choose from these windows instead of from the shifts their rank happened to qualify for. Rank plays no part here: a window is an hour of the station's week, and anyone may claim it.

## Where this shows up

- **My Availability** — a member ticks the windows they could work, on the days they fall.
- **Member Availability** (*Scheduling → Member Availability*) — the same windows, listed by date, with the names of everyone who claimed them. That is the screen to answer "who can cover Tuesday night?".

> [!NOTE]
> Editing a window changes it for every member at once, including the days ahead. If you only want to stop *new* claims while leaving the history alone, set an end date rather than changing the days or hours.
