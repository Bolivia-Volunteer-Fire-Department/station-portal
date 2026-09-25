*Scheduling → Member Availability* answers one question: **who is available to work each shift?** Members mark the shifts they could take in their own My Availability module, and this tab is where that is read and corrected.

> [!IMPORTANT]
> Viewing and maintaining member availability requires the **Manage member availability** role permission.

## All Members

The tab opens on **All Members**, because the overview is the point of the screen.

It lists every shift in the month, grouped by date, with:

- the shift's time window and assignment, and
- the names of the members who have marked themselves available for it.
- any **events** happening that day, listed on the date heading — training, a meeting, a detail.

> [!TIP]
> The events on a date are often the reason fewer people are available for the shifts on it. They are shown once per date rather than per shift, so a busy day stays readable, and they are not audience-filtered here: an event aimed at one rank still appears, because the schedule is built from this whole view.

**Each name carries its rank** — the rank's color, with the rank's icon beside it — so a glance down a shift shows who is senior enough to lead it without opening anything. Hover a name to see the full label, such as *Member 1 — Driver/Operator*.

Members with no rank, or a rank whose color is blank, keep a plain green chip instead. If several people look identical when you expect them to differ, that is usually the `ranks` sheet rather than this list — see **Ranks**.

Three deliberate rules make it readable:

1. **Members who said nothing are absent.** An empty list means nobody has marked that shift — not that the feature is broken.
2. **Shifts nobody has marked stay visible.** An uncovered shift is precisely the one worth spotting, so those rows are shown, marked *No one available*, and counted in a summary at the top.
3. **It is a list, not a grid.** The question is "who can work this?", and names read far better in a line per shift than crammed into a calendar cell.

## One member at a time

Pick a member from the dropdown and you get **the same calendar they see**: a month grid of the shifts their rank qualifies them for, with their ticks.

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
> The list each member sees is preloaded with the shifts **their rank qualifies for**, so the absence of a shift from someone's list usually means they do not hold the rank for it — not that they declined it. See **Ranks** for the comparison rule.

## Why a shift shows nobody

In order of likelihood:

1. **Nobody has opened their availability this month.** It is a manual action, and a quiet month looks the same as a broken feature. If it is consistently empty, ask people to check their own screens.
2. **The shift is a custom one-off.** Availability is based on the weekly templates, so a custom shift added on the board does not appear in anyone's availability list and will always show as uncovered.
3. **The rank requirement is too high for anyone available.** If an assignment needs a Lieutenant and the only Lieutenants have not marked that shift, the row stays empty. That is a signal worth acting on rather than a fault.
