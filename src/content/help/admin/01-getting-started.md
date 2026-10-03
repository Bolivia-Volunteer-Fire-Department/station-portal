## Welcome

The **Administration** module is where the department is configured. This guide explains how the module is organized and, more importantly, **why you can see the tabs you can see**. Each tab then has its own guide in the list on the left.

## What loads, and when

Nothing is read until you need it. The app reads what the screen in front of you draws — and nothing else — so opening a tab may show a brief **Loading …** line the first time.

That line is worth knowing about, because it tells apart two things that look alike: a list that is **still arriving** shows the loading line, and a list that is **genuinely empty** shows none. If you see an empty table with no loading line, nobody has put anything there yet.

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

Administration saves are last-writer-wins: if two people save the same record, the second save is the one that stands, so open a record fresh before editing it rather than leaving one open in a tab. The writes that could corrupt each other — clocking in and out, approving a shift offer, saving a personal-best score — run as all-or-nothing transactions on the server, and a save that fails for any reason means **nothing was applied**, so pressing Save again is safe.

## Adding a tab's guide

These guides live in the repository at `src/content/help/admin/`. Add a `.md` file and it appears in the list: the first `# heading` becomes the title, and a numeric filename prefix (`01-`, `02-`) sets the order. Member-facing guides are a separate set in `src/content/help/member/` and appear in the members' **Help** module instead.
