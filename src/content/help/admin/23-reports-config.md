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
| **Data source** | **Schedule** (shifts) or **Training (hours)** (hours signed for) |
| **Visualization** | How it is drawn: **Table**, **Bar graph**, **Pie graph** or **Line graph** |
| **Group by** | What the rows and columns are. *Schedule*: assignment, member, day or month. *Training*: category, member, training, day or month |
| **Description** | An optional line, up to 300 characters, shown with the report |
| **Scope** | The runner's **own** records, or the whole **station** |

## Scope is a permission, not only a filter

A scope the runner's role cannot read is refused when the report is run, so the two have to line up:

| Data source | My … needs | Station needs |
|---|---|---|
| Schedule | **View their schedule** | **See whole crew** or **Manage schedule** |
| Training | **Sign trainings** | **Administer trainings** |

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
