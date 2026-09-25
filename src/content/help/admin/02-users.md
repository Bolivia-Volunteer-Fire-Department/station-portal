## Definition

A user is the term for someone who has a profile in this application. Sometimes users are referred to as "members", meaning a member of the fire department.

> [!IMPORTANT]
> Configuring users requires the **Manage users** role permission.

## The fields

| Field | Notes |
|----|----|
| **Name** | The display name used everywhere — schedules, clock entries, availability, notifications |
| **Username** | What they sign in with. Must be unique |
| **Password** | On a new member, the password they start with; on an existing one, leave blank to keep the current password |
| **Must change password at next login** | Sits under the password field. The member signs in with the password once, then has to choose their own before they can do anything else |
| **Status** | **Active** or **Inactive** |
| **Role** | Decides which modules and which Administration tabs they get — see **Roles** |
| **Rank** | Decides which shifts they may be given and offered — see **Ranks** |
| **Scheduling** | Whether the member is excluded from scheduling |

> [!NOTE]
> **Name matters more than you might expect.** It is what members see on the *Currently on duty* card, what appears on schedule pills and in the crew list, and what is sent in a push notification. The username is only ever a login.

## Excluded from scheduling

Set **Scheduling** to exclude a member and they are left out of the schedule entirely: they are not offered open shifts, and their availability calendar stays empty. On the schedule board they are grouped separately from the eligible members with the reason shown, rather than being hidden, so you can see that they exist and why they are not available.

Use it for anyone who is not on the roster — new recruits in training, someone on long-term leave, retired members kept for their clock history. It is a scheduling flag only: they keep their rank, their history and their access.

## Creating and editing

1. Fill in the form and save. For a new member the password is required, since there is nothing to keep.
2. Allow a few seconds — an admin save reloads the whole directory, the schedule, the templates and the offers, so other tabs reflect the change immediately.

> [!NOTE]
> **Leaving the password blank on an edit keeps the existing one.** Passwords are stored as a salted hash, so the form cannot show you the current one; blank is how you say "do not change it". Typing a new password replaces it and **signs that member out of their other sessions** — worth warning them about.

## Handing over a password the member has to replace

Tick **Must change password at next login** when you set someone's password for them — a new member, or anyone who has forgotten theirs. They sign in with that password once and land straight on a *Choose a new password* popup; until they save a new one they cannot open any other part of the portal. They can sign out instead, but signing back in brings the same popup until a new password is saved.

The flag clears itself the moment they set their own password, so nothing has to be unticked afterwards. Until they do, the member stands out on the Users list with a **Password change due** badge — worth checking there before you phone somebody about a problem signing in.

> [!NOTE]
> **The tick and the password belong together.** Unticking the box does not change anybody's password; it only says the current one may be kept. If you set a password, type it, and leave the box unticked, the member keeps that password for as long as they like.


## Deactivating rather than deleting

Setting **Status** to *Inactive* is usually better than deleting. An inactive member cannot sign in, but their clock history, past shifts and availability stay intact, and reactivating them later restores everything. Deleting removes the row, and their records are left pointing at a member who no longer exists, which can cause errors.

> [!CAUTION]
> Only delete users that have no information related to them, or are duplicated.
