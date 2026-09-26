A read-only record of what has happened in the portal: who signed in (and who failed to), what was changed and by whom, and which notifications were sent.

> [!IMPORTANT]
> Access to this area requires the **View the system log** role permission.

The tab is fetched **only when you open it**. If your role has the permission but you never look at the log, it costs nothing — which is why opening it shows a spinner rather than appearing instantly.

| Column | What it holds |
|---|---|
| **ID** | The row number in the `system_log` sheet, in the order entries were written |
| **Timestamp** | Station local time (America/New_York) |
| **Member** | Who it was about. A failed sign-in names the *typed username*, which may not be a real member |
| **Action** | A short code such as `USER_LOGIN`, `LOGIN_FAILED`, `PASSWORD_CHANGE` |
| **Details** | Free text from whatever wrote the entry |

## Reading it

Entries are **newest first** by default, twenty to a page. The badge color on an action is a rough hint rather than a severity rating:

- **Red** — something failed, was denied, or was removed (`LOGIN_FAILED`, `...DECLINED`).
- **Green** — something completed (`USER_LOGIN`, `...APPROVED`).
- **Grey** — everything else.

Actions are matched on whole words, so `CLOCK_IN` shows as a normal event — it contains "LOCK", but nobody is going to mistake a clock-in for a lockout.

## Filtering and sorting

| Control | What it narrows to |
|---|---|
| **From** / **To date** | A date range. Either end can be left open |
| **Action** | One action code, from every action present in the log |
| **Member** | One member — or one typed username, if that is what the entry recorded |
| **Sort by** | Timestamp (either direction), action A–Z, or member A–Z |

Changing any of these makes **one request** and returns to page one, because the filtering and paging both happen on the server. The count in the header is of *matching* entries, not the whole log; the word "filtered" appears beside it when the two differ.

**Previous** and **Next** move one page of twenty. If a filter change leaves you on a page that no longer exists you are moved to the last real page rather than shown an empty table.

> [!NOTE]
> **Millions of rows would still list twenty at a time here, but the server does read the whole log to filter it.** So filtering is the same cost however you narrow it, and reading a *page* is cheap because only that page crosses the network.

## What this is for

- **"Who changed this?"** — filter by action, or by member, and read the details.
- **"Did somebody try to break in?"** — filter to `LOGIN_FAILED` and look at the spread of timestamps and usernames. Repeat failures against one name are what the sign-in throttling is reacting to.
- **"Did the notification go out?"** — the push events are logged as their own actions.

> [!NOTE]
> The log is **read-only here**. Nothing in the app writes to it directly, and nothing in it can be edited or deleted from the app.

## If it is slow

The log only ever grows, and the server reads all of it before filtering, so a very large log will eventually feel slow to open and to re-filter. When that happens the fix is on the sheet rather than in the app: archive `system_log` rows older than a year into another tab and delete them from `system_log`. Nothing in the app reads the archive.

> [!CAUTION]
> Have Matt help you with this!
