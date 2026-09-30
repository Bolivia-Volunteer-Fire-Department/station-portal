The **Timeclock** module is your dashboard. It shows the current time, your clock status, and who else is on duty right now.

## The station clock

The large digital clock is the station's own time, not your device's, so it is the time to trust when you are deciding whether you are on duty. Everything in the app uses that same clock: your shifts, your clock history, and the timestamps on your entries.

## Clocking in and out

If your role is one that has access to clock in and out, you will see options to do so.

1. Press **Clock In** when you start, or **Clock Out** when you finish.
2. Allow the location prompt if your browser asks. Your position is recorded with the entry.
3. The card updates to show your new status.

Both buttons are in the same card, but only one is shown at a time — **Clock In** while you are off duty, **Clock Out** while you are on — so there is nothing to get wrong. That is enforced on the server too: if a second clock-in arrives while you already have an entry open (a slow connection, or the app open in two tabs), it is refused with "You are already clocked in" rather than opening a duplicate entry that an administrator would have to clean up by hand.

If your browser asks you to confirm your password before the action completes, that is the session re-check described in **Getting started**. Confirm it and the clock action runs automatically; you do not need to press the button again.

> [!IMPORTANT]
> **Clocking in and out needs a connection.** Everything else in the app keeps working without one — the schedule, your history, these guides — but a clock entry is a statement about *when* you were at the station, so the app refuses to record one it cannot timestamp honestly. While you have no signal the buttons are switched off and the card tells you why; the moment your signal is back they turn on again, without a refresh.

## Your location is recorded

Clock entries store where they were made, which is how the department can tell a clock-in at the station from one made from home. Two things can go wrong:

- **Nothing is captured.** You may have declined the location prompt, or your device may have location switched off. The app will say so. Allow location for the site in your browser settings and try again.
- **You are too far from the station.** If the department has set a station location, clocking in or out is only accepted within a set distance of it. The message tells you how far away you are and what the limit is, so **move closer and try again**.

## Currently on duty

The card below yours lists everyone clocked in at the moment, with how long they have been on. It updates as people clock in and out — you do not need to refresh anything, and you will see somebody appear while you are looking at the screen.

## Announcements

Station announcements appear in the sidebar, and the newest ones on the dashboard. Like the on-duty card, they appear as soon as they are posted rather than at your next sign-in.

## If something looks wrong

- **The Clock In or Clock Out button is grayed out** — you are offline, and the card says so. Nothing is wrong with your record: reconnect and the buttons come back, and the entry is recorded at the moment you press it.
- **A clock action failed with a network message** — the request never reached the server. Check your connection and try again; nothing was recorded.
- **You clocked in at the wrong time** — tell an administrator.
- **Your hours look short** — you may have clocked in and never clocked out. An entry with a missing time out is still open; an administrator can close it.
