A read-only record of what has happened in the portal: who signed in (and who failed to), what officers changed and for whom, and which notifications were sent.

> [!IMPORTANT]
> Access to this area requires the **View the audit log** role permission.

## Where these rows come from

The lines are written to **Cloud Logging** as the app runs — every action that changes something records who did it and what they did — and this tab **reads them back on demand** when you open it. That has three consequences worth knowing:

- **Nothing is stored in the database**, so the log costs the station nothing to keep and cannot slow any other screen down.
- **The tab is fetched only when you open it.** If your role has the permission and you never look, it costs nothing at all.
- **The same lines are in the Firebase console** (Logging → Logs Explorer), where they can be searched and kept for longer than this tab shows. Filter for `jsonPayload.audit.action` to see the audit trail alone.

| Column | What it holds |
|---|---|
| **Timestamp** | Station local time (America/New_York) |
| **Member** | Who it was about. A failed sign-in names the *typed username*, which may not be a real member |
| **Action** | A short code such as `USER_LOGIN`, `SIGN_IN_FAILED`, `ADMIN_SAVE_ROLE` |
| **Details** | Free text from whatever wrote the entry |

## Reading it

Entries are **newest first**, twenty to a page. **Older** walks further back through the log, and **Newest** returns to where you started — the log service hands out a token for the next page and does not say how many pages there are, so there is no page count to show.

The badge color on an action is a rough hint rather than a severity rating:

- **Red** — something failed, was denied, or was removed (`SIGN_IN_FAILED`, `...DECLINED`).
- **Green** — something completed (`USER_LOGIN`, `...APPROVED`).
- **Gray** — everything else.

Actions are matched on whole words, so `CLOCK_IN` shows as a normal event — it contains "LOCK", but nobody is going to mistake a clock-in for a lockout.

## Filtering and sorting

| Control | What it narrows to |
|---|---|
| **From** / **To date** | A date range, in whole station days. Either end can be left open |
| **Action** | One action code |
| **Member** | One member — or one typed username, if that is what the entry recorded |
| **Sort by** | Newest first or oldest first — the two orders the log service can apply itself |

Changing any of these makes **one request** and starts again at the newest end, because a page token from the old result means nothing to a new filter.

The **Action** and **Member** dropdowns list the values seen in the *recent* part of the log rather than every value it has ever held: listing every one of them would mean reading the whole log, which is exactly the cost this design avoids. If something you are looking for is not in the list, it is older than the sample the dropdowns were built from — open the Firebase console for a search across everything.

## What this is for

- **"Who changed this?"** — filter by action, or by member, and read the details.
- **"Did somebody try to break in?"** — filter to `SIGN_IN_FAILED` and look at the spread of timestamps and usernames. Repeat failures against one name are what the sign-in throttling is reacting to.
- **"Did the notification go out?"** — the push events are logged as their own actions.

> [!NOTE]
> The log is **read-only here**. Nothing in the app writes to it from a browser, and nothing in it can be edited or deleted from the app.

## If it does not load

If the tab says the audit log could not be read, the function that serves it is missing permission to read Cloud Logging on this project. The fix is a role — *Logs Viewer* for the function's service account — and it is a change Matt has to make in the Firebase console.

> [!NOTE]
> Cloud Logging keeps entries for **30 days** by default. A longer trail is a *log sink* configured in the console rather than anything in the app. There is no archive to trim and no sheet to tidy: nothing here is stored in the station's database.
