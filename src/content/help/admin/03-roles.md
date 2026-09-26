A role is the term used for describing how a user can interact specifically with this application. A member has **one** role, and the role decides which modules appear in their sidebar and which Administration tabs they can open.

> [!IMPORTANT]
> Configuring roles requires the **Manage roles** permission in your own role.

## How to use
The role list is at the top of the tab and the permission editor below it — click a role to edit it.

## Administrator access

**Administrator access** is the master switch. While it is checked:
- the role can use every module and every tab, and
- the other permission boxes are **checked and locked**, because a master switch that could be contradicted by another box would not mean anything.

Uncheck it and the boxes become editable again, so you can build up a role from nothing.

## The permissions

Each permission grants its own tab, or its own member-facing ability. None of them grant Administration as a whole.

**People**

- **Manage users** — *People → Users*.
- **Manage roles** — *People → Roles*. Cannot be used to grant Administrator access, or to edit or delete a role that has it; only an administrator can do that.
- **Manage ranks** — *People → Ranks*.

**Scheduling**

- **Manage schedule templates** — the recurring weekly pattern.
- **Manage assignments** — what a shift is (its minimum rank, color and icon).
- **Manage the schedule** — placing templates on real dates, and custom shifts.
- **Manage member availability** — *Scheduling → Member Availability*: seeing who has marked themselves available, and editing it on any member's behalf.
- **Approve shift requests** — *Scheduling → Pending Approvals*, plus the *New shift requests* notification switch in User Settings.

**Timeclock**

- **Manage the timeclock** — *Timeclock → Clock Management*: correcting entries, adding manual ones, exporting.

**System**

- **Manage system settings** — *System → System Settings*.
- **Manage notification settings** — *System → Notifications*. Without *Manage system settings*, this role may write only the notification keys, so it cannot be used to change unrelated settings, and the Firebase credential card stays administrator-only.
- **View the system log** — *System → System Log*. Read-only, but it names members and records failed sign-ins, so grant it deliberately rather than by default. The tab loads only when it is opened, so it costs nothing to someone who never looks.

**Member abilities**

These do not open Administration at all; they decide what the member can do in their own modules.

- **View my schedule** — the **My Schedule** module.
- **Make offers** — offering to fill open shifts. Cannot be stored without *View my schedule*.
- **View full schedule** — the **Show everyone** button on My Schedule. Cannot be stored without *View my schedule*.
- **Edit own availability** — the **My Availability** module.
- **Use the timeclock** — the **Clock In**/**Clock Out** buttons and the **Clock History** module. Without it a member still sees the Timeclock module, but only the clock and the *Currently on duty* list.
- **Sign trainings** — the **Training** module. Without it the module is not in the sidebar at all, because signing is the whole point of it.
- **Manage trainings** — the add/edit form in the Training module. Cannot be stored without *Sign trainings*, since a role that may change a training but cannot open the module would have nowhere to do it.

## Dependencies

Three permissions require another, and the form disables them with the reason in the tooltip:

- **Make offers** requires **View my schedule** — there is no schedule to offer on otherwise.
- **View full schedule** requires **View my schedule** — there is no calendar to show everyone on otherwise.
- **Manage trainings** requires **Sign trainings** — the add/edit form lives inside the Training module, which a role without *Sign trainings* cannot open.

The server enforces the same rule, so it is not only a form convenience. Availability is deliberately **not** chained this way: a role may manage other members' availability without the member-facing *Edit own availability*, since one is a scheduling job and the other is a personal one.

## Which flags to check for a shift approver

Someone who approves shifts needs **Approve shift requests**, and if you want them to receive the push notification about new offers they also need that same check — the notification and the tab use one permission, not two. They do **not** need **Manage the schedule** unless they also build the roster.

## Reading a role at a glance

The list shows how many of the permissions each role has, so a role showing *4 of 16* is obviously partial and one showing *16 of 16* is a full role without Administrator access.
