// Which notification switches a member is offered, and what each one means.
//
// A blank cell in `user_settings` means "inherit the station default" from
// `system_settings`, which an admin configures under Administration > System >
// Notifications.
//
// `approverOnly` marks a type that is only meaningful to a role that can act on it:
// "New shift requests" is about offers waiting on an approval, so a member whose
// role cannot approve anything is not offered the switch at all - it would be a
// control that does nothing. The other two concern the member's OWN offers and
// apply to everyone.
//
// Kept dependency-free (and out of the component) so the rule can be exercised
// without React - see scripts/verify-notification-prefs.mjs.
import { isTruthyFlag } from './rankEligibility';

export const NOTIFICATION_TYPES = [
  {
    key: 'notify_new_offer',
    // The member's own switch, and the station default's, say the same thing from two sides; the
    // station-facing wording sits in stationLabel/stationDescription below.
    label: 'New shift requests',
    description: 'Someone offered to take an open shift and it needs approval.',
    stationLabel: 'New shift requests',
    stationDescription: 'Ping admins when a member offers to take an open shift.',
    approverOnly: true,
  },
  {
    key: 'notify_offer_approved',
    label: 'My shift request approved',
    description: 'An admin approved the shift you offered to take.',
    stationLabel: 'Shift request approved',
    stationDescription: 'Tell the member when an admin approves the shift they offered to take.',
  },
  {
    key: 'notify_offer_declined',
    label: 'My shift request declined',
    description: 'An admin declined the shift you offered to take.',
    stationLabel: 'Shift request declined',
    stationDescription: 'Tell the member when an admin declines the shift they offered to take.',
  },
  {
    key: 'notify_announcements',
    // Offered to every member: an announcement can be aimed at anyone. Turning it off silences the
    // PUSH only - the announcement still appears in the app, which is what keeps opting out from also
    // opting out of reading the department's notices.
    label: 'Announcements',
    description: 'Push announcements to your devices. They still appear in the app either way.',
    stationLabel: 'Announcements',
    stationDescription: 'Push announcements to members\u2019 devices. They still show in the app either way.',
  },
  {
    key: 'notify_chat_direct',
    // THE SAME PROMISE AS ANNOUNCEMENTS, for the other half of chat: the push is silenced, the message is not. A member who
    // turns this off still sees the badge and still finds the conversation where it was - so this switch is about a phone
    // buzzing, never about missing something.
    label: 'Direct messages',
    description: 'Push private conversations. The message and its badge are still there either way.',
    stationLabel: 'Direct messages',
    stationDescription: 'Push private conversations to members\u2019 devices. The message still arrives in the app either way.',
    chatOnly: true,
  },
  {
    key: 'notify_chat_rooms',
    label: 'Room messages',
    description: 'Push messages in the station rooms you are in. The message and its badge are still there either way.',
    stationLabel: 'Room messages',
    stationDescription: 'Push room messages to members\u2019 devices. The message still arrives in the app either way.',
    chatOnly: true,
  },
];

// The switches to show this member.
//
// APPROVER-ONLY TYPES ARE DROPPED for a member whose role cannot approve shifts, and CHAT TYPES for one whose role cannot use
// chat at all - and that second one is not cosmetic: a member without `can_use_chat` is never sent a chat push (the fan-out
// does not reach them and neither does the notification), so the switch would be a control that does nothing. That is the
// same judgement the note at the top of this file makes about approver-only types, applied to the permission chat rests on.
//
// The flags are read with `isTruthyFlag`, the same TRUE-parsing used for other sheet-backed booleans, so it behaves whether
// the caller passes a real boolean (as App.jsx does) or a raw `can_approve_shifts` cell value.
//
// `canUseChat` DEFAULTS TO TRUE, deliberately: it is the permissive direction, and a caller that has not been taught the new
// argument yet shows a member one extra switch rather than hiding a switch they were meant to have. The two callers that
// must pass it - My Settings and the admin tab - both do (see verify-notification-prefs.mjs, which asserts it).
export const visibleNotificationTypes = (canApproveShifts, canUseChat = true) =>
  NOTIFICATION_TYPES.filter((type) => {
    if (type.approverOnly && !isTruthyFlag(canApproveShifts)) return false;
    if (type.chatOnly && !isTruthyFlag(canUseChat)) return false;
    return true;
  });
