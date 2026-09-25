*Scheduling → Pending Approvals* is the queue of members asking to fill open shifts. It is the counterpart of the member's offer flow: they ask, you decide.

> [!IMPORTANT]
> Approving shift requests/offers requires the **Approve shift requests** role permission.

## What appears here

Every offer that has been made and not yet decided on, oldest first, so the longest-waiting request is at the top. Each row shows the member, the shift they want (date, time window and assignment), their assignment and the hours involved.

> [!NOTE]
> **Only undecided offers are listed.** An offer you have approved or declined leaves the queue, and the badge in the header counts what is still waiting. If the queue looks empty, there is nothing outstanding — it is not a loading problem.

## Deciding an offer

- **Approve** writes the member onto that shift. The schedule board and the member's own calendar both update to show them on it.
- **Decline** closes the offer without touching the schedule, leaving the shift open.

Either way **the member is notified** on any device they have registered for notifications, and their calendar stops showing the amber pending pill.

> [!TIP]
> Approving also closes any other offers waiting on the same slot, so nobody is left told they are still in the running for a shift that has just been filled.

## Sorting and filtering the queue

Above the table are three controls:

| Control | What it does |
|---|---|
| **Member** | Show only one member's offers. |
| **Assignment** | Show only offers for one assignment. |
| **Sort** | How the queue is ordered. |

The member and assignment lists are built from **the offers actually waiting**, not from the whole roster — a filter listing everyone in the department, most of whom have nothing pending, would be mostly dead ends. **Clear filters** appears once either is set, and a count shows what is being shown, such as *3 of 11 offers*.

**The queue is sorted by shift date, soonest first, by default.** This is a list of decisions to make, and the soonest shift is the one that needs making first. The other orders are latest first, by member name, and by assignment name.

Within a single day, shifts are always listed in **start-time order**, even when the dates run the newest-first — so a day reads in the same order the schedule shows it. An offer whose shift has no readable date sorts to the **end** of the list either way, rather than floating to the top of one direction: a missing date is not the earliest shift, and it is not the latest one either.

Filtering and sorting only change what you see. Approving or declining acts on the offer itself, and the queue reloads with the rest of the Administration data afterwards.

## The shift must still be open

Offers are matched to a shift that was unfilled when the offer was made. If somebody else was assigned to it in the meantime, approving cannot fill it — check the schedule instead, and decline the offer with a message to the member if it was lost that way. A member cannot offer on a shift that is already filled, and the same member cannot hold two pending offers on one shift.

## Where the shifts come from

A shift is open either because a template slot has nobody on it, or because somebody was removed from it, or because it was created as a vacancy with **Add Shift**. All three are offerable, and all three appear here.

## Being told about new offers

Tick **New shift requests** in *User Settings → Notifications* to be pushed a notification each time a member offers. It is the same permission as this tab, so anyone who can approve can opt into the notification — and if you approve shifts, tick that switch, because offers arrive whenever members happen to look at their schedule rather than at a convenient time.

## If a decision looks like it did not take

The action refreshes the queue, the schedule and the offers list in one go, which takes a few seconds. Confirm on **Schedule Management** that the shift now shows the member before assuming the approval failed, and reopen this tab if the row is still listed — a rejected decision shows a message explaining why.
