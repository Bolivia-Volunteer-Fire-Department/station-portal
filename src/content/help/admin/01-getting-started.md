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

## Adding a tab's guide

These guides live in the repository at `src/content/help/admin/`. Add a `.md` file and it appears in the list: the first `# heading` becomes the title, and a numeric filename prefix (`01-`, `02-`) sets the order. Member-facing guides are a separate set in `src/content/help/member/` and appear in the members' **Help** module instead.
