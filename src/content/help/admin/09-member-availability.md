*Scheduling → Member Availability* answers one question: **who is available to work each shift?** Members claim the availability windows they could work in their own My Availability module, and this tab is where that is read and corrected.

> [!IMPORTANT]
> Viewing and maintaining member availability requires the **Manage member availability** role permission.

## All Members

The tab opens on **All Members**, because the overview is the point of the screen.

It lists, for each day of the month, the availability windows that fall on it, with:

- the window's nickname and its hours, and
- the names of the members who claimed it — each carrying their rank's color and icon.

Windows come from *Scheduling → Availability Windows*, so the list is short and the same for everybody. An empty window is worth spotting: it is a gap to fill or a window nobody wants.

> [!NOTE]
> Availability is **not rank-gated, by design**. A window is an hour of the station's week rather than a slot somebody has to qualify for, so a name on this list means "they could work it", not "they are eligible for the shift that happens to fall then". The rank rules still govern who you may *schedule* — see **Ranks**.

**Each name carries its rank** — the rank's color, with the rank's icon beside it — so a glance down a shift shows who is senior enough to lead it without opening anything. Hover a name to see the full label, such as *Member 1 — Driver/Operator*.

Members with no rank, or a rank whose color is blank, keep a plain green chip instead. If several people look identical when you expect them to differ, that is usually the **Ranks** tab rather than this list — see **Ranks**.

Three deliberate rules make it readable:

1. **Members who said nothing are absent.** An empty list means nobody has marked that shift — not that the feature is broken.
2. **Shifts nobody has marked stay visible.** An uncovered shift is precisely the one worth spotting, so those rows are shown, marked *No one available*, and counted in a summary at the top.
3. **It is a list, not a grid.** The question is "who can work this?", and names read far better in a line per shift than crammed into a calendar cell.

## One member at a time

Pick a member from the dropdown and you get **the same calendar they see**: a month grid of the windows that fall in it, with their marks.

- Change it exactly as they would, then save. It is one batched request.
- **Discard** throws pending ticks away, and switching member does too, so one person's draft never leaks into another's.
- Past dates are shown but cannot be edited.

This is what you use when someone phones in their availability, or when a member asks you to change it because they cannot sign in. From a workflow standpoint, it is strongly recommended that members are encouraged to enter their own availability.

## What availability is and is not

Availability is a **statement of interest**, not a commitment and not a permission:

- It does **not** put anyone on a shift. Only the schedule does that.
- It does **not** block scheduling. You can fill any shift with anyone the rank rules allow, and the schedule board simply warns when someone has not marked that shift available.
- It **does** tell you who to call first when you need cover, which is its main use.

> [!NOTE]
> Windows are **station-wide**, so every member sees the same list — and one they claimed is one they could work, whatever their rank. If a shift has no names against it, that is information about the week rather than about anybody's eligibility.

## Why a window shows nobody

In order of likelihood:

1. **Nobody has opened their availability this month.** It is a manual action, and a quiet month looks the same as a broken feature. If it is consistently empty, ask people to check their own screens.
2. **The month is not loaded.** If the tab says so, press **Load *month*** — the app will not show you an unloaded month as if it were empty on purpose, but the notice is easy to skim past.
3. **The window has been retired.** A window whose end date has passed still reads in the history but offers nothing new, so it appears on no day. Check *Scheduling → Availability Windows* for an **In force** badge.
4. **The window covers a different day than you expect.** A window is drawn on the days it is ticked for, and that is the day it **starts** — a Tuesday night running to 08:00 belongs to Tuesday.
