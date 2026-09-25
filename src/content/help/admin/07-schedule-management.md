*Scheduling → Schedule Management* places the weekly templates on **real dates** and is where you build and repair the roster. Everything else on this page assumes the templates and assignments are already correct.

> [!IMPORTANT]
> Managing the schedule requires the **Manage the schedule** role permission.

## Reading the board

Each day shows its shifts, ordered by start time. A shift is one of:

| Appearance | Meaning |
|---|---|
| **Filled pill** | A member is on it. The pill shows their name, the assignment and the time |
| **Vacant pill** | Nobody is on it. It is drawn in muted styling and labelled with the **assignment** rather than the word "Open" |
| **Empty slot** | A template slot with no row at all. Click it to assign somebody |

Vacant shifts also carry a warning icon, and an orange count appears in the header, when nobody on the shift has marked themselves available for it — see *Member availability* below.

## Assigning somebody

**Click an empty slot or a vacant pill** to open the assignment dialog. Members are listed with only the people who can actually take the shift:

- Members whose **rank qualifies** for the assignment.
- Anyone **excluded from scheduling** is grouped separately with the reason, rather than being hidden, so you can see they exist and why they are not offered.

An empty slot always belongs to a template, so filling it does not create a row — it fills the one the pattern already implies.

## Editing a filled shift

**Click a filled pill** and choose:

- **Change the member** — assign somebody else.
- **Remove from shift** — clears the member but **keeps the shift**, leaving it vacant and offerable. This is the one you want when someone calls in unavailable and you still need cover.
- **Delete Shift** — removes the row entirely. Only offered for **custom shifts**, because a template slot has nothing of its own to delete: the template will simply report the slot again.

## Adding a custom shift

**Add Shift** creates a one-off shift on any date, for anything the weekly pattern does not cover.

- **The member is optional.** Leave it blank and the shift is created as a **vacancy**, which members can then offer to fill — the same state as removing somebody from an existing shift. This is the quickest way to advertise a hole.
- The **assignment is required**, since it supplies the shift's color, its icon and its minimum rank.

## Moving a shift

**Drag a pill onto another day** to move it. The drop position sets the new day, and the time is kept.

## Member availability

The warning on a shift means nobody rostered on it has marked that shift available. It is **informational and never blocks saving** — the schedule is yours to set, and availability is a guide, not a permission.

Members set their availability themselves in their **My Availability** module, and you can see or change it for them in *Scheduling → Member Availability*. That tab's **All Members** view, showing every shift with everyone who marked it available, is the fastest way to fill a vacancy: it tells you who to call rather than who to move.

## Approving offers changes this board

When you approve an offer in **Pending Approvals**, the member is written onto the shift and the board reloads to show it. You do not need to fill the shift here yourself for an offer you intend to accept.

## Printing the schedule

The **Print** button beside the month arrows prints a clean, printer-friendly calendar of the month you are looking at — the department's patch at the top, the month, and every shift with the member's name, its times and its assignment. Lines marked **Open** are shifts nobody is on yet. Choose your printer or **Save as PDF** in the dialog.

It prints the **saved** schedule, not the board as you have edited it. If you have unsaved changes the button says so — save first if the printout needs to include them.

## Saving

The board holds your edits until you save, so you can make several changes at once. A save writes the whole batch in one request — each write to the sheet has real overhead, and batching means the wait does not grow with the number of edits.

> [!WARNING]
> Unsaved edits survive **switching tabs and reloading** — the board keeps a draft in the browser's session storage and restores it, with the pending badge still showing. Closing the tab discards it, and a draft is per browser, so switching to a different device will not find it. Save before leaving for the day.
