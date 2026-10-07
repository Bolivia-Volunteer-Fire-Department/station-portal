# Reports Configuration

*Reports → Reports Configuration* defines the reports members and officers can run. Press **New report**, or **Edit** on a row, and the editor opens **over the page** with Save and Cancel in a bar at the top.

> [!IMPORTANT]
> Requires the **Configure reports** permission, which itself requires **View reports**. The tab is not shown without it.

> [!NOTE]
> A report is a saved **definition**, not the numbers themselves. The figures are worked out when somebody runs it, over the date range they choose — so a definition written today keeps working as new shifts and trainings are recorded. Nothing here reads or changes the underlying data.

## The definition

| Field | What it decides |
|---|---|
| **Name** | How the report is listed. 2–80 characters |
| **Data source** | **Schedule** (shifts), **Training (hours)** (hours signed for), or **Clocked vs scheduled (hours)** |
| **Visualization** | How it is drawn: **Table**, **Bar graph**, **Pie graph** or **Line graph** |
| **Group by** | What the rows are, **in order**. More than one can be chosen — *Month*, then *Member* — and the first is the outer heading. *Schedule*: assignment, shift template, member, day or month. *Training*: category, member, training, day or month. *Clocked vs scheduled*: member, shift template, day or month |
| **Description** | An optional line, up to 300 characters, shown with the report |
| **Scope** | The runner's **own** records, or the whole **station** |

## Scope is a permission, not only a filter

A scope the runner's role cannot read is refused when the report is run, so the two have to line up:

| Data source | My … needs | Station needs |
|---|---|---|
| Schedule | **View their schedule** | **See whole crew** or **Manage schedule** |
| Training | **Sign trainings** | **Administer trainings** |
| Clocked vs scheduled | **View their schedule** | **Manage the timeclock** *and* **See whole crew** or **Manage schedule** |

> [!IMPORTANT]
> A station-wide reconciliation shows how long every member was on station, so it asks for **Manage the timeclock** on top of a schedule permission. A role that may build the schedule but has no business reading clock history cannot run one — and a member can always run their own.

## Clocked vs scheduled: what it compares

This is the report you write to reconcile paid time. Each row is a member, and it shows **three numbers**:

- **Scheduled** — the hours of shifts they were assigned to, added up (an overnight shift counts for the hours it actually spans, not the day it starts on).
- **Clocked in** — the hours of their clock entries in the same range.
- **Difference** — clocked minus scheduled. That is the number the report is for, and the rows are sorted so the biggest mismatches come first.

Two things about it are deliberate and worth knowing before you read a number off it:

1. **The tickboxes narrow only the *scheduled* side.** You tick the assignments — and, finer still, the **shift templates** — that count as paid time; every clocked hour still counts. That second list is the one that matters when an assignment has more than one pattern: *Officer* is one assignment, but **Officer – Day** and **Officer – Night** are two templates at two rates, so ticking the template is how you reconcile one rate at a time. A one-off shift has no template, so ticking any template leaves those out. A clock entry does not record which shift somebody was on — the app never asks at clock-in — so a reconciliation compares the two totals rather than pretending to match entries to shifts. That asymmetry is the useful part: it is how a volunteer's hours, or a paid member's extra hours, show up beside the paid schedule that was supposed to cover them.
2. **Somebody with no shift at all still gets a row.** If they clocked in and nothing was scheduled, that shows as *Scheduled 0* — which is the row worth looking at, not one to hide.

> [!NOTE]
> **An entry that is still open** (nobody has clocked out yet) has no length to measure, so it is counted in a **Still open** column and left out of the hours — the same as the member's own Clock History, which also cannot total an entry that has no end. That column appears only when there is one.

## Grouping by more than one thing

**Group by** is a list, and you can add up to **three** levels to it, moving them with the arrows. The order is what the reader sees, so *Month* then *Member* reads as each month, with its members underneath:

```
2026-01
  Ana
  Bo
2026-02
  Ana
```

The **first** level is the outer heading and each one after it nests a step further in. Two things follow from that, and both are deliberate:

- **More than one level is a table.** A graph has one axis, so the bar, pie and line options are switched off while a second grouping is selected, and a report grouped that way is drawn as a table whatever was asked for. That last part is enforced by the server as well as the screen — a request built by hand cannot produce a two-level graph.
- **The order comes from the grouping, not the size.** A report grouped by one thing still puts the biggest row first; a report grouped by two or more reads in the order you chose, because sorting those rows by size would scatter each month's members through the table.

## Ordering the rows

**Order by** is a list too, built the same way, and it can be left **empty**. It offers the levels the report is *grouped by* plus the report's own number, because a row only carries what it was grouped by — ordering a report grouped by month alone by *Member* would have nothing to sort on.

Putting the **number first** is the part worth having: *Difference, high to low*, then *Member* gives the biggest mismatches at the top with names breaking the ties, which the default cannot express. Each key has its own direction — **Low → high** or **High → low** — so *Month* can run forwards while the number runs backwards.

Left empty, a report behaves as it always has: grouped by one thing, the biggest row first; grouped by several, in the order of its groupings.

## Printing and exporting

**Print** and **Save CSV** both follow the grouping:

- **The printed sheet nests the headings** the way the screen does, so *Month* then *Member* prints as each month with its members indented under it.
- **The CSV gives each grouping level its own column** instead of one combined label. A spreadsheet has no headings to nest, so *2026-01, Ana* becomes two cells — which is what makes the file pivotable and filterable.
- A reconciliation exports **a column per measure** (*Scheduled*, *Clocked in*, *Difference*) rather than a single number.

## Date ranges

**Last week** is the calendar week that just ended — **Sunday to Saturday**, the same seven days the schedule draws as one week — while **Last 7 days** is the seven days ending today, today included. They answer different questions, and both are on the list.

## What the runner may change

By default a report runs exactly as defined. Tick a box under **Parameters when the report is launched** to hand the runner control of one thing:

- **Viewer can change the date range** — every report asks for a range. Left unticked, the **default date range** below is used and the range is fixed.
- **Viewer can change what the report is grouped by**
- **Viewer can change the visualization**
- **Viewer can filter by training category** (training reports only)
- **Viewer can choose which members to include** (station-scoped reports only)

Anything left unticked uses the value set in the definition.

## Who can use it

Under **Who can use this report?**, choose either **Everyone with View reports**, or tick the **roles** and **ranks** it is shared with. A matching role or rank grants access in addition to the **View reports** permission — an officer whose role is not named and who has no other schedule/training permission will not be able to read what the report needs and it will be refused.

## Turning one off, and deleting one

Leave **Enabled** ticked to offer the report. Untick it to keep the definition without showing it to anybody: a disabled report is marked in the list and is not offered when reports are run, but its settings stay.

**Delete** removes the definition. It does not touch any data — the shifts and training signatures it described are untouched. The deletion asks for confirmation first, and says that people who had access will no longer be able to run it.

## Where reports are read

Members and officers with **View reports** find what they are entitled to under **Reports** in the sidebar. That screen only ever lists the reports shared with the reader's role or rank, so a report is written once here and reaches exactly the audience chosen above.
