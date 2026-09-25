*Scheduling → Assignments* defines **what a shift is** — Driver, Officer, Firefighter, etc. Both the schedule templates and the one-off custom shifts are built from these, so this is the first thing to set up.

> [!IMPORTANT]
> Configuring assignments requires the **Manage assignments** role permission.

## The fields

| Field | Notes |
|---|---|
| **Description** | The name of the assignment, as it appears on shifts |
| **Minimum Rank** | The lowest rank that may fill it (defaults to Firefighter) |
| **Color** | The color of every pill for this assignment |
| **Icon** | Drawn beside the assignment name on schedules |
| **Effective Date** | **Required.** The first date it may be used |
| **End Date** | Optional. The last date it may be used. Blank means it still can be |

## Retiring an assignment instead of deleting it

The **Effective Date** is required: every assignment says when it came into use. The **End Date** lets you retire one without deleting it. That matters because deleting an assignment strips the name, color and rank rule from every shift that used it — so a shift from last year stops reading the way it read when it was worked.

A retired assignment:

- **Cannot be chosen for anything new.** It disappears from the assignment pickers on the schedule board and on the schedule templates form.
- **Stops producing shifts through its own templates**, the same way a retired template does.
- **Does not remove shifts already on the schedule.** Those are real shifts that were worked or are planned; they keep their name, color and icon, and anyone assigned to one stays assigned.

> [!IMPORTANT]
> Retiring an assignment also stops every template that uses it from drawing shifts. The form warns you and names how many, but if the shift pattern should carry on after the assignment ends, give those templates their own end dates instead.

Both dates are inclusive — an assignment effective July 1 can be used *on* July 1, and one ending June 30 can be used *on* June 30. The end date **must not be before** the effective date.

> [!NOTE]
> Assignments created before the effective date was required still have a blank cell and **keep working** — a blank cell is read as "no start date" rather than as an error, because treating it as one would retire those assignments at once. They show **⚠ No start date** in the list, and giving one a date the next time you edit it clears the warning.

## Minimum rank

This is the field with real consequences. The assignment stores the **rank order number** of the minimum rank, and a member may fill the shift if their own rank order is at least that high.

- Set a *Firefighter* minimum and everyone from Firefighter upwards can take it, including a Captain covering a vacancy.
- Set a *Lieutenant* minimum and firefighters cannot be scheduled onto it or offered it.

The comparison uses rank **order**, not rank names, so reordering your ranks changes assignment eligibility. See **Ranks** before editing the order.

## Colors

The color is used for every pill this assignment appears on: the member's calendar, the administrator's schedule board, the availability screens and the pending-approvals queue. It is how people tell shifts apart at a glance, so it is worth setting deliberately.

Leave the color blank and the assignment keeps an **automatic color** derived from its id. That is perfectly usable — the app will never leave a shift uncolored — and it means you only need to choose colors for the assignments you want to distinguish strongly.

## Icons

The icon catalogue is the same one the **Ranks** tab uses, so the two look like one system. The icon is drawn beside the assignment name on schedule pills, in the schedule details list, and in the pending-approvals queue.

## Adding an assignment

1. **Description** — something members will recognise. This is drawn on every pill for the shift, so keep it short; "Engine 1" reads better than "Engine 1 - Station 2".
2. **Minimum Rank** — the lowest rank that may take it.
3. **Color** and **Icon** — as above.
4. **Effective Date** — required; the first date the assignment may be used. **End Date** — leave blank unless you are retiring it; see above.
5. Save, then check **Schedule Management**: existing shifts using this assignment update immediately, because a shift stores a reference to the assignment rather than a copy of it.

## Deleting an assignment

Shifts and templates that referenced it keep their record but lose the name, color and rank rule. Vacancies on those shifts fall back to a generic label instead of the assignment name.

> [!CAUTION]
> Avoid deleting assignments. If you are replacing one, **retire it with an End Date** and add the replacement with an Effective Date. The shift history then stays readable, and you only delete an assignment you have just created by mistake.
