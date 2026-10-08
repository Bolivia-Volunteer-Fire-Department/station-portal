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

## Attaching the scan

A record can carry **one optional file** — the scan or the photo of the card itself. Optional in the real sense: a record saves with or without one, and attaching is a separate act afterwards, so an upload that fails never stops you recording the certification.

Open the record and the **Attached scan** section is at the foot of the form. On a record that has not been saved yet it says so rather than offering an upload that could not work: the server reads the record to know whose file it is. Once the record exists, **Attach a scan** takes a **PDF, a JPEG or a PNG up to 5 MB** — one or two pages of an ID card or a certificate, which is what these are. A photo taken on a phone is scaled down in the browser before it is uploaded, so a twelve-megapixel picture of a card arrives a few hundred kilobytes lighter and just as readable.

**View** opens what is attached, **Replace** swaps it for another file, and **Remove** takes it off the record. There is one file per record by design, so Replace is how a wrong scan is corrected rather than ending up with two.

> [!IMPORTANT]
> Two kinds of file are refused, and both refusals are deliberate. **HEIC** photos — what an iPhone shoots by default — because no browser can display one, and a file nobody can open is worse than no file. And **SVG**, because an SVG is a picture that can carry code. A screenshot, or setting the camera to JPEG (Settings, Camera, Formats, Most Compatible), is the answer to the first.

The scan belongs to the **period**, not to the member: a renewal is a new record with its own file, so the evidence for 2024–2026 stays where it is when 2026–2028 is recorded. Deleting a record deletes its scan with it — and the file is deleted from storage too, which is not something anybody can undo.

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

The **Upload** column is the same kind of check, for the attached scan: a check means the record has one (see *Attaching the scan* above) and an em dash means it does not. The record keeps that one fact as a file is attached or removed, which is what lets the list answer the question without reading every attached file just to draw a column. It is a summary rather than the truth, though: open the record and the **Attached scan** section shows what is really there.

## The names beside the icons

The **Member** column shows the certification icons that member currently holds, for the certifications whose setup says to show them. Those are the same icons members and administrators see beside a name elsewhere in the app.

> [!NOTE]
> An expired certification loses its badge, deliberately: an icon beside a name is the app asserting that somebody is certified, and it should not assert something the station cannot back.
