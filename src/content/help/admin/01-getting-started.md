## Welcome

The **Administration** module is where the department is configured. This guide explains how the module is organized and, more importantly, **why you can see the tabs you can see**. Each tab then has its own guide in the list on the left.

## The tabs

| Group | Tabs |
|----|----|
| **People** | Users, Roles, Ranks |
| **Scheduling** | Schedule Templates, Assignments, Schedule Management, Member Availability, Pending Approvals |
| **Timeclock** | Clock Management |
| **Training** | Training Report |
| **System** | System Settings, Notifications, System Log, Help |

## Two people saving at once

Administration is edited by more than one person, so a save can meet another save. Nothing is lost silently:

- **"Someone else changed this record while you were editing it, so your change was NOT saved."** Another administrator saved the same record after you opened it. Reload it (open it again from the list) and reapply your change — the app refuses the write rather than letting your copy overwrite theirs.
- **"The station portal is busy saving something else, so your change was NOT saved."** Two large saves met, for the space of a moment. Your change was not applied and nothing was half-written; it retries once by itself, and pressing Save again is safe.

Both messages mean the same thing: **nothing happened**, so acting again is the right response. The technical detail — locks, row versions, what is deliberately not protected — is in [`docs/WRITE_SAFETY.md`](../../../docs/WRITE_SAFETY.md) in the repository.

## Adding a tab's guide

These guides live in the repository at `src/content/help/admin/`. Add a `.md` file and it appears in the list: the first `# heading` becomes the title, and a numeric filename prefix (`01-`, `02-`) sets the order. Member-facing guides are a separate set in `src/content/help/member/` and appear in the members' **Help** module instead.
