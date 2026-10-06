# Certifications

*People → Certifications* records what each member holds, one row per **period**. It is the administrative half of the Certifications module members see, and the catalog it works from is defined in *Certification Setup*.

> [!IMPORTANT]
> Recording certifications requires the **Manage certifications** permission, and defining the catalog requires **Set up certifications**.

## Recording a certification

Press **New record** at the right of the table, and the editor opens **over the page** — member, certification, dates and notes, with Save and Cancel in a bar at the top of it that stays put while the form scrolls. A row's **Edit** opens the same editor, and it closes when the save lands; a save that fails keeps it open with the reason in it.

Choose the member, the certification, and the dates.

- **Effective date** is when the period started. Leave it blank for one that has always applied.
- **End date** is when it runs out. It is **disabled for a certification that cannot be renewed** — a one-off achievement has no expiry, and the server clears the field whatever is typed into it, so the rule holds even if the record is edited by hand.
- **Notes** is a free line for a certificate number or a reminder.

## Renewals are new rows, not edits

A renewal is a **new period**, recorded as another row. Editing an existing row is for correcting a mistake.

> [!NOTE]
> This is the point of keeping the periods rather than overwriting one. Overwriting the last period would leave the station able to answer "is this member certified today?" and nothing else — no history of when they were certified before, which is what an audit or an insurance question actually asks for.

A member with several periods of one certification therefore has several rows, and their own module shows all of them with their dates.

## What the table tells you

The **Status** column comes from the dates and the setup, never from a screen's own arithmetic:

| Status | Meaning |
|---|---|
| **Current** | Inside its dates, and not yet inside its warning window |
| **Expires soon** | Inside the warning window that *Certification Setup* set for it |
| **Not yet effective** | The effective date is still in the future |
| **Expired** | The end date has passed |

The filter above the table opens on **Everyone**, and **Expiring or expired** is the one to press when the question is "who is running out" — it counts them in the button.

The **Notes** column is a check: it says whether a record has notes at all, not what they are. A paragraph does not belong in a table row, and what you usually need from the list is "which of these have something written against them" — open the record to read them. An em dash means there is nothing there.

## The names beside the icons

The **Member** column shows the certification icons that member currently holds, for the certifications whose setup says to show them. Those are the same icons members and administrators see beside a name elsewhere in the app.

> [!NOTE]
> An expired certification loses its badge, deliberately: an icon beside a name is the app asserting that somebody is certified, and it should not assert something the station cannot back.
