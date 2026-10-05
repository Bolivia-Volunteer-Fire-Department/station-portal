*Scheduling → Schedule Management* places the weekly templates on **real dates** and is where you build and repair the roster. Everything else on this page assumes the templates and assignments are already correct.

> [!IMPORTANT]
> Managing the schedule requires the **Manage the schedule** role permission.

## Reading the board

Each month is read when you open it or move to it, so a brief **Loading …** line is normal while you move around the calendar. When it is gone, what you see is the month in full.

Each day shows its shifts, ordered by start time. A shift is one of:

| Appearance | Meaning |
|---|---|
| **Filled pill** | A member is on it. The pill shows their name, the assignment and the time |
| **Vacant pill** | Nobody is on it. It is drawn in muted styling and labeled with the **assignment** rather than the word "Open" |
| **Empty slot** | A template slot with no row at all. Click it to assign somebody |

A member's name carries two marks on the pill, both set in *Scheduling → Ranks* and *Certifications*: a **rank dot** in the rank's color before the name, and any **certification icons** they currently hold after it. They are the answer to "who is on with me" without opening anything — hover the dots and icons to see what they stand for.

Vacant shifts also carry a warning icon, and an orange count appears in the header, when nobody on the shift has marked themselves available for it — see *Member availability* below.

## On a phone: one day at a time

The board reads the **month today falls in** and shows you **today**, one day to a card, rather than the whole month on a screen too narrow to read it. Nothing is read twice for this: the day you are looking at is part of the month already loaded, so moving between days costs nothing.

| | Wide screen | Phone |
|---|---|---|
| Shows | The whole month | One day |
| **◀ ▶** step | A month | **A day** |
| **Today** | The month today falls in | Today |
| **Day** (calendar button) | — | Opens a month to pick a day from |
| Member picker | A panel anchored to the pill or slot you clicked | A dialog, with the day's pills left uncovered |

**Getting to a day that is not nearby.** The **Day** button beside the arrows opens the month in a small window that holds nothing but the calendar. Press a day and the board goes there — one press for *the 14th of next month*, where the arrows would be fourteen presses and a month boundary on the way. It reads no more than the walk would: a day inside the month on screen is already in hand, and a day in another month reads that month.

The picker has its own **◀ ▶** for paging through months while you look, and the board behind it does not move until you choose a day. It opens on the month you are reading, with the day you are on marked.

Because a day has the whole card to itself, its pills are **not clipped**: a shift shows who is on it and its times on two lines, where the month view has to fit the same facts onto one line and leave the rest to the tooltip.

**On a phone the member picker is a dialog.** Clicking a pill or an empty slot opens the same picker in the middle of the screen rather than as a panel hanging off what you clicked: a 300px panel anchored to a pill covers the very shifts you are choosing between, on a screen that is barely wider than the panel. The list and the actions are identical — Escape, the backdrop and the ✕ all close it — and on a wide screen it goes back to hanging off the pill, where there is room for it.

Walking past the last day of a month moves into the next one and reads it, exactly as the calendar does — one month of shifts at a time, whichever view you are in. Resizing the window (or rotating a tablet) switches between the two views on the spot, keeping the day you were reading, and costs no read.

> [!NOTE]
> The switch happens at the same width the sidebar changes shape at, so the board and the layout around it always agree about whether this is a phone-shaped window or a wide one.

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

Where a pill can land, and what happens when it doesn't:

| Dropped on | Result |
|---|---|
| **An empty slot** | The shift moves there, taking that slot's assignment and apparatus |
| **A vacant pill** (an open shift) | The shift moves there and **fills it** — the open row it replaced is removed, because the moved shift now occupies that slot |
| **A pill with somebody on it**, tapped and released | Refused, and told who is already on it — with a reminder that holding swaps the two |
| **A pill with somebody on it**, held there for about a second and a half | **The two shifts change places.** The pill blinks while the hold is being read, then the two are shown exchanged; letting go keeps it, and moving out before letting go puts them back |
| **The same spot it came from** | Refused — nothing to do |
| **A past day** | Refused: past days are locked |
| **The empty space of a day**, or a **custom shift's** pill | Refused, with a note on where to aim instead |

A refused drop always says why, in a message at the top right — it never just does nothing. Nothing is written until you **Save**, so a move or a swap you did not mean can be undone with **Discard**, and the message after filling a vacant slot or swapping two shifts reminds you that it happened.

> [!NOTE]
> **The hold is what makes a swap deliberate.** Releasing a pill on somebody else's shift without holding is only ever a message — there is no chance of swapping two people's shifts by accident, in either direction.

> [!NOTE]
> **Drag and drop is for moving a shift, not for filling one.** To put a member on a vacancy without touching anybody else's shifts, click the vacant pill and pick them — that is the assignment dialog, and it leaves the shift where it is.

## Member availability

The warning on a shift means nobody rostered on it has marked that shift available. It is **informational and never blocks saving** — the schedule is yours to set, and availability is a guide, not a permission.

Members set their availability themselves in their **My Availability** module, and you can see or change it for them in *Scheduling → Member Availability*. That tab's **All Members** view, showing every shift with everyone who marked it available, is the fastest way to fill a vacancy: it tells you who to call rather than who to move.

## Approving offers changes this board

When you approve an offer in **Pending Approvals**, the member is written onto the shift and the board reloads to show it. You do not need to fill the shift here yourself for an offer you intend to accept.

**Declining is final for that member on that shift.** Their pill turns rose and reads *Declined*, and they cannot offer for it again from the app — which is the point: it stops the same offer going backwards and forwards. It does not lock them out of the shift. If they call you the next day with a good reason, assign them the same way you would for anyone else, by editing the shift and choosing their name.

## Printing the schedule

The **Print** button beside the month arrows prints a clean, printer-friendly calendar of the month you are looking at — the department's patch at the top, the month, and every shift with the member's name, its times and its assignment. Lines marked **Open** are shifts nobody is on yet. Choose your printer or **Save as PDF** in the dialog.

It prints the **saved** schedule, not the board as you have edited it. If you have unsaved changes the button says so — save first if the printout needs to include them.

## Saving

The board holds your edits until you save, so you can make several changes at once. A save writes the whole batch in one request, so the wait does not grow with the number of edits.

**A save only ever touches the month you are looking at.** The board works on the month on screen and saves that month, so editing and saving March cannot disturb April however many shifts the year holds — it is the difference between a tool that edits a board and one that quietly rewrites history.

> [!WARNING]
> Unsaved edits survive **switching tabs and reloading** — the board keeps a draft in the browser's session storage and restores it, with the pending badge still showing. Closing the tab discards it, and a draft is per browser, so switching to a different device will not find it. Save before leaving for the day.
