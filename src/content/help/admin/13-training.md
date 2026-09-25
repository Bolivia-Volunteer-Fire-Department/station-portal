*Training → Training Report* is the department's training record with the signatures attached: what was held, and who has signed that they attended.

> [!IMPORTANT]
> Managing trainings and training signatures requires the **Administer trainings** role permission. That permission is deliberately the *strongest* of the three training permissions, because this tab is the only place that can do all of the following: - see **every member's** signatures (everywhere else in the app a member only ever sees their own), - **change or delete** any training, and - **remove** a signature.

## The report

Each row is one training: date, title, location, instructors and how many members have signed it. Rows are most recent first.

**Expand a training** — click the arrow at the left, or the number in the *Signed* column — to see the members who signed it, as a list of names. Each name has a remove button beside it. The training's narrative appears under the list.

Rename or correct a training with **Edit**, which loads it into the form at the top of the page; **Delete** removes it entirely.

## Filtering, and totalling training hours

The **Filter & sort** bar above the report drives both the list and the totals beneath it, so the numbers always describe exactly what is on screen.

| Control | What it narrows to |
|---|---|
| **From date** / **To date** | A date range, with either end left open |
| **Location** | One location, from those the trainings were actually held at |
| **Member** | **All Members**, or one member |
| **Signatures** | *Signed only* or *Not signed only* — meaningful once a member is selected |
| **Sort by** | Date (newest or oldest first), title, or longest duration |

**Choosing a member turns the report into an attendance statement.** *Member: Member 2* with the date range set to a year and **Signed only** lists exactly what Member 2 has signed, and the **Training hours** tile totals his durations for that period — e.g. "18.5 hrs". That sum is the reason the totals sit under the filter bar rather than in a corner.

The **Signed by this member** tile is deliberately hidden for **All Members**, where a signature count for one person is not a meaningful question; the two totals that always apply — how many trainings and how many hours — are shown instead.

An empty result reads *No trainings match these filters* rather than looking like an empty sheet.

## Adding and editing trainings

The card at the top of this tab is collapsed until you click it. It is the same form a training manager sees in their own Training module, with one difference: **only here can you set "Entered into an external system"**.

| Field | Notes |
|---|---|
| **Date** | Required |
| **Title** | Required — a training without a date and a title cannot be displayed or signed |
| **Start time** | Optional |
| **Duration (hours)** | A decimal, such as `2` or `1.5` |
| **Location**, **Instructors** | Free text |
| **Narrative** | What was covered; shown under the signature list |
| **Classification** | Certification, drill, fire prevention, multi-company, training facility, officer training, driver training, and **entered into an external system** |

**Edit is available here for a training that has been signed.** That is the point of the rule: the Training module closes a training as soon as anybody signs it, and changes from then on are made here, deliberately.

## The external-system marker locks a training for good

Ticking **Entered into an external system** is permanent. It should be set once the training has been filed in whatever external system records it, and doing so:

- **locks the training itself** — no field can be changed again, by anyone,
- **locks its signatures** — none can be removed, added or altered,
- **prevents deletion**, and
- cannot be unticked in the app. **Only the training sheet can clear it.**

The app asks you to confirm before it sets the marker, and says all of the above at the time. A locked training shows a padlock in the **Ext.** column, and its Edit, Delete and signature-remove controls are all disabled — including for you.

Treat it as the last step for a training: collect the signatures, check the details, then file it.

## Removing a signature

This is the one action in the app that can take away a member's acknowledgement, so it asks for confirmation and names the member. Use it when:

- a member signed the wrong training by mistake,
- a training was entered twice and someone signed both rows, or
- a signature was recorded against somebody who did not attend.

After removal the member can sign that training again, so correcting a slip does not lock anyone out of the record. It has to happen **before** the external-system marker is set.

**Nobody can sign on someone else's behalf**, including you. Signatures are made by the member themselves; this tab can only remove them.

## Deleting a training

Deleting a training **also deletes every signature recorded against it**, which is why the confirmation tells you how many that is. It cannot be undone, and the members concerned lose their record of attending.

Prefer correcting a training over deleting it. Correcting is cheap; re-collecting signatures is not. Only delete one that was created in error, ideally before anybody has signed it.

## If a member says they cannot sign

1. **Check the training exists here.** Signatures need a training to attach to, which means it must have a date and a title.
2. **Check the member's role** has *Sign trainings* in *People → Roles*. Without it the Training module is not in their sidebar at all.
3. **Check nothing is already recorded** against them for that training — a training shows as signed once it has a signature, and they cannot sign twice.
4. **Ask them what their screen says.** A failed save reports itself above the list, and the module shows how many trainings they have signed out of the total.
