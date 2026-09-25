*Timeclock → Clock Management* is the department's clock record: every entry, who it belongs to, and the corrections. It is where you fix what members cannot fix themselves.

> [!IMPORTANT]
> Managing the timeclock requires the **Manage the timeclock** role permission.

## What the table shows

| Column | Notes |
|---|---|
| **Member** | Who the entry belongs to |
| **Time In** / **Time Out** | When they clocked in and out. A blank time out means the entry is still open |
| **Duration** | The length of a completed entry |
| **Location** | Where it was recorded, if the device provided it |
| **Manual** | **Yes** for any entry an administrator created or changed |

Times follow your own **Time Format** preference, so they match the rest of the app for you.

## Filtering

Three controls above the table:

- **Filter by Member** — one person, or **All Members**.
- **Status** — **All Entries**, **Active (Clocked In)**, or **Completed**.
- **Sort By** — **Time In (Newest First)**, **Time In (Oldest First)**, **Duration (Longest First)**, or **Member Name (A-Z)**.

Use *Active (Clocked In)* to answer "is anything still open?" — every entry it lists is one somebody never clocked out of — and *Time In (Oldest First)* to work through a pay period from the start.

Sorting by member name keeps each person's own entries in date order rather than scrambling them, so it reads as a roster rather than a jumble.

> [!NOTE]
> These are the same options the member's own Clock History offers, from one shared implementation, so the two views cannot disagree about what "newest first" means. The only difference is that **Member Name** is offered here and not there, since a member only ever sees their own entries.

## Fixing an entry

- **Add New Timeclock Entry** creates one from scratch — for someone who could not clock in, or for a shift worked before the system existed.
- **Edit Entry** corrects an existing one, including setting a time out on an entry that was left open.

> [!CAUTION]
> **Anything you create or change is flagged as manual.** That flag is deliberate and permanent for that entry: it makes a correction visible to anyone reviewing the record, so the hours and the story behind them stay reconcilable.

## The location column

Location comes from the member's device at the time of the clock action, and is only captured if they allowed the location prompt. Two consequences:

- A blank location is normal, not an error — it means the device did not provide one.
- The department can optionally restrict clocking to within a set distance of the station, in *System → System Settings → Clock Location*. That check happens before the entry is ever created, so a rejected clock action leaves **nothing** in this table — there is no row to correct, and the member simply needs to try again from closer, or with location allowed.

## Exporting

**Export CSV** downloads the table as filtered, so narrow it first and then export if you need a pay-period extract rather than everything.

## Open entries

An entry with no time out keeps the member on the *Currently on duty* card. Those are usually a forgotten clock-out, and closing one is a normal correction: set the time out to when they actually finished, and the entry becomes manual so the change is recorded.

If an open entry is from a member who has left, closing it is still the right move — an indefinite open entry will otherwise sit on the on-duty list forever.
