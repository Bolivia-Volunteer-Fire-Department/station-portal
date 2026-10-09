*Content → Chat Rooms* is where you set up the station's chat: one row per room, who can see it, and the order they appear in for everybody. It does **not** read or write anybody's messages — an officer with this permission is not automatically in the rooms they create.

> [!IMPORTANT]
> Setting rooms up requires the **Manage chat rooms** role permission. *Having chat at all* is a separate permission on the role — **Chat** — and it is what members need before they can see a room, open the panel or receive a chat notification. See *Roles*.

## The fields

| Field | Notes |
|---|---|
| **Name** | Required, up to 60 characters. The name shown in the member's room list |
| **Order** | Where the room sits in the list. Lower first; rooms sharing a number fall back to alphabetical order |
| **Everyone may see this room** | The common case. Unticked, choose **one** of the three ways below |
| **…or a role** | Every member whose role is this one — for example an officers-only room |
| **…or a rank** | Every member whose rank is this one |
| **…or one member** | A room for a single person, with whoever sent the message |
| **Archived** | Kept, but marked as out of use. Members who can see it still see it |

A room needs a name and at least one of those four answers. A room with no audience cannot be saved, because a room nobody can see looks exactly like a room that was never created.

## What members see

A room appears in a member's Chat panel — the launcher button at the bottom-right of every screen, and the **Chat** module in the sidebar — if their role, their rank or they themselves are named by it, or if it is open to everyone.

The **Last message** column on this tab is the one line the member's room list shows under the room's name. It is kept up to date as messages are sent, and emptied when the newest message is removed — so a message removed for a good reason stops being quoted at the top of everybody's list.

## Deleting a room

**Delete** asks once and then removes the room, every message in it, and each member's place in it. It cannot be undone, and it is deliberately a separate press from editing.

## Private conversations

Members can message each other without a room: **Message a member**, at the top of their own room list, starts a conversation nobody else can see — one person, or several, up to 12.

Two things about them belong in this guide:

- **Who is offered is decided by roles, not by this tab.** The picker lists every member whose role grants **Chat** and nobody else, and the server refuses anyone left out — so the list offered and the list accepted cannot disagree. If a member says "I cannot message somebody", check that person's role here: a role without Chat is invisible to chat entirely.
- **They are not rooms, so they are not here.** Private conversations never appear in this tab, because this tab edits and deletes everything it lists, and a conversation between two members is not an administrator's row to edit. They are also not named: what each member sees is the *other* members' names, from their own side.

## What this tab does not do

- **It does not give you a seat in the room.** Reading and writing in a conversation follow the room's audience, not this permission.
- **It does not change who may use chat.** That is the **Chat** permission on the member's role.
- **It does not moderate messages.** Editing and removing other members' messages are their own permissions on the role — see *Roles*.
