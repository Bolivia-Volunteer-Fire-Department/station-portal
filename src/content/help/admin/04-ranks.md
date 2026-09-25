*People → Ranks* defines the department's rank structure. Ranks relate mostly to the schedule and assignments.

> [!IMPORTANT]
> Editing ranks equires the **Manage ranks** role permission.

## The fields

| Field | Notes |
|---|---|
| **Description** | The rank name, such as Firefighter, Driver/Operator, Lieutenant |
| **Rank Order** | A number. **A higher number is a higher rank** |
| **Color** | The color used for rank badges and the icon beside a member's name |
| **Icon** | An icon drawn beside the member's name and rank |

## Rank order is the important one

Rank order is what the scheduling logic actually compares. It is used to decide:

1. **Which assignments a member may fill.** An assignment has a *minimum rank*, and a member may take it if their own rank order is at least that high. So a Captain may take a Firefighter shift, but a Firefighter may not take a Captain's.
2. **Which open shifts a member is offered.** Shifts they do not qualify for are not shown to them at all, on My Schedule or on My Availability.
3. **Which shifts their availability calendar preloads.** Same rule again, which is why a member who says "that shift never appears for me" usually just does not hold the rank for it.
4. **The order of the crew on a shift.** When several members share a shift, they are listed by the **rank the shift requires**, highest first, then by name.

A higher number means more senior, so a Chief is a larger number than a Firefighter. If you set them the wrong way round, everyone's eligibility silently inverts.

## Colors and icons

Both are cosmetic but they are used consistently:

- The **color** appears on rank badges and beside the member's name.
- The **icon** is drawn from the same catalogue as assignment icons, so ranks and assignments look like part of the same system.

> [!NOTE]
> Leaving the color blank gives that rank an automatic color derived from its id, which is perfectly usable — set a color only when you want a specific one.

## Editing ranks safely

- **Renaming is safe.** Assignments reference a rank by its order number, not by its name, so changing "Driver" to "Driver/Operator" does not disturb anything.
- **Reordering is not cosmetic.** Changing a rank's order number changes what every member holding it may be scheduled for. If you insert a rank in the middle, you may need to renumber the others, and you should expect the eligibility rules to move with them.
- **Deleting a rank** leaves any member still assigned to it without a rank. Those members are treated as having no rank order at all: they can take shifts that have no minimum rank, and nothing else.
