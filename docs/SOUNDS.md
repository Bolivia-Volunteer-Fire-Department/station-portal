# Sounds

The app makes five kinds of noise, from nine files in `src/assets`. This document is the map: where each one comes
from, what decides whether it plays, and the places that are deliberately silent — which is the list worth
reading, because those are the gaps somebody will otherwise report as a bug.

Everything here is covered by `npm run verify:sounds`, which is what stops the wiring rotting.

## The sounds

| File | Used for | Played from |
|---|---|---|
| `click.mp3` | **Every press on a control** — buttons, switches, pills (grab, release, click), menu items, dropdowns, checkboxes, radio choices | The one delegated listener in `utils/uiSounds` |
| `click_double.mp3` | Consequential, infrequent actions — **save, delete, edit, cancel, export, print, sign out, approve** | The same listener, on the controls the rule below recognises |
| `modal_positive.mp3` | A modal the member opened, or a form they are expected to fill in | Each modal component as it mounts, via `MODAL_SOUNDS` |
| `modal_error.mp3` | A modal that interrupts, or reports a refusal | Same table |
| `notification.mp3` | A push notification that arrives while the member has the app open | `notificationToast()` in App.jsx |
| `sound_on.mp3` / `sound_off.mp3` | The **Sound Effects** switch in User Settings, and nothing else | The switch itself, via its `data-sound` directive |
| `toast_success.mp3` / `toast_error.mp3` / `toast_normal.mp3` | Every toast, by kind | The sonner wrapper in `utils/toast` |

## Why one listener, not 145 call sites

There are ~130 `onClick` handlers in the app. A sound played from each of them would be wrong within a month:
somebody adds a button, forgets the sound, and the app is inconsistent in a way nobody can see in a diff.

Instead `installUiSoundListeners()` (called once, from App.jsx) listens on the document for `pointerdown`,
`pointerup`, `dragstart`, `dragend` and `change`, and decides from the *event target* whether the press was a
control. The rules are in `utils/soundRules` and are pure functions, so they are tested directly rather than by
clicking around.

What counts as a control: `button`, `[role="button"|"menuitem"|"option"|"tab"|"switch"|"checkbox"|"radio"]`,
`a[href]`, `summary`, `select`, `input`, a `label` that is bound to a control, `[draggable="true"]`, and anything
marked `data-sound="click"`.

**A mouse press sounds immediately; a finger sounds on release.** Pressing a physical button is instantaneous, so
the mouse click plays on `pointerdown`. A finger is different: on a touch screen the press begins wherever it
lands, so a sound there would fire every time somebody flicked a list — the tap is played on `pointerup`, and only
if the finger stayed put. A touch that becomes a scroll arrives as `pointercancel` and is dropped entirely.

**Grab and release are two sounds only for an actual drag.** The press is the grab, and a mouse release is sounded
only if the pointer moved (6px) — otherwise every tap would click twice. An HTML5 drag (the schedule board's
pills) sounds on `dragend` instead, because its release never arrives as a `pointerup`.

## Which clicks are heavier

`click_double` is for an action that is **consequential and infrequent**: save, delete, remove, edit, rename,
cancel, export, download, print, sign out, log out, approve, decline, discard, revoke, archive. The everyday
clicking — navigation, toggles, filters, pagination, pills, clocking in and out — keeps the plain click.

**The exclusions matter as much as the list**, because a sound that fires on most presses says nothing:

- **Clock in / clock out** are the most-pressed buttons in the app, often in a hurry. The confirmation there is
  the dashboard changing in front of you.
- **"Reset" and "Clear"** are almost always a filter or a draft, not data. **"Close"** is a dismissal — the same
  reasoning as the silently-dismissed backdrops. **"Add" / "New"** opens a form; the form's own Save carries the
  weight.

Which controls get it is decided from what a control already says about itself, rather than a marker on each of
~30 buttons:

1. Its **accessible name** — `aria-label`, else `title`, else its visible text, capped at 40 characters so a
   clickable card holding a paragraph is not judged by the paragraph.
2. Its **icon**, because this app's Edit and Delete buttons are icon-only: a pencil and a bin, with no text to
   read. lucide puts the icon name in the class (`lucide-trash-2`), which is what the rule looks at. A spinner is
   not the save it belongs to, so `lucide-loader-circle` is deliberately absent — as are the X, the plus and the
   eye.

`data-sound="click-double"` promotes anything the rule cannot see, and `data-sound="click"` demotes a false
positive, so the rule never has the last word.

`npm run verify:sounds` prints the rule's verdict on every button in the codebase, so the line it draws can be
read at a glance, and fails if the heavier sound ever covers most of the interface — at which point it would no
longer mean "this one mattered". As it stands: **24 heavier actions against 34 plain ones.**

**Levels.** `SOUND_VOLUME` in `utils/soundRules.js`: the plain click is the quietest thing in the app (it fires on
every press), `click_double` sits a step above it — present enough to confirm, still under the one-shot sounds —
and the rest are at the default.

## The setting: member, then station, then on

`is_sounds_active` is read from three places, in order:

1. **`user_settings.is_sounds_active`** — the member's own switch in *User Settings → Sound Effects*. Always
   written as `TRUE`/`FALSE` when they save.
2. **`system_settings.is_sounds_active`** — the station default, with a control in
   *Administration → System → Sound Settings*. Defaults to **TRUE** when the row is missing.
3. **On**, if neither exists.

A blank cell is not a decision: it means "inherit", the same convention the notification preferences use. So a
member who has never touched the switch follows the station, and the login screen (where no member row is loaded
yet) follows the station too.

`user_settings` **grows its own header row**, so the column appears by itself on the first save — there is no
manual spreadsheet work. The verifier proves that by lifting the real `upsertUserSettingsColumns` out of
`Code.gs` and running it against a stand-in sheet: the column is appended without moving the existing ones, a
second save does not duplicate it, and a member with no row yet still saves. `system_settings` does not grow, so
that one is a row you add (`is_sounds_active` = `TRUE`) — and it is only needed if you want the station default
to be **off**, since a missing row already means on.

## Changing a sound, or adding one

- **Which sound for a modal:** `MODAL_SOUNDS` in `utils/soundRules`. Every `*Modal.jsx` component must declare its
  own key, and the verifier fails if one does not — a new modal cannot be silent by accident, and a stale entry
  cannot hide a deleted component. Unlisted modals default to **positive**.
- **Which sound for a toast:** `TOAST_SOUNDS`, by kind. Anything unrecognised gets `toast_normal`.
- **Volume:** `SOUND_VOLUME`. The click is mixed at 0.35 rather than 0.8, because it fires on every single press
  and at the same level it reads as noise rather than feedback.
- **A click on a control the selector cannot see** (a `div` with an `onClick`): add `data-sound="click"` to it.
  `data-sound="click-double"` promotes a control to the heavier click, and `data-sound="none"` silences a whole
  subtree.


## Deliberately silent

These are decisions, not oversights. Each is asserted in the verifier, so changing one is a deliberate act:

- **Dismiss backdrops.** Clicking outside a modal, or on the mobile drawer's backdrop, to close it makes no sound
  — dismissing something is not an action on a control, and the modal's own opening tone has already played.
- **The Firefighter Runner.** Its root carries `data-sound="none"`, so the app's click never layers over its own
  jump/die/point audio. Those are untouched, and it keeps playing them whether or not the member has app sounds
  on: the switch is about the *interface*, not the minigame. User Settings says so out loud.
- **Clicking a field to type in it.** Typing is not a press. Only entering the field is, and that is a plain
  click.
- **Scrolling on a touch screen.** A finger that lands on a button and then travels was scrolling; it makes no
  sound, and neither does the gesture it was part of (see above).
- **The OS notification banner.** A push notification's sound comes from the device, not the app. Turning app
  sounds off does not silence the operating system's own alert, and the app cannot reach it.
- **Text selection, table rows, and empty calendar space.** Nothing there is a control.

## Things that could have a sound, but have none

Reported rather than fixed, because each needs a decision rather than a line of code:

1. **Destructive confirmations are native `window.confirm`.** Nine of them (delete user, delete event, delete
   template, delete clock entry, and the rest). A browser-owned dialog cannot be styled, cannot be sounded, and
   looks nothing like the rest of the app. Replacing them with an in-app confirm modal would give them
   `modal_error` when they open and a toast sound on the outcome — at the cost of nine new modals.
2. **The items inside a native `<select>`.** The browser draws that list and the app never sees a press on an
   option. The press that *opens* the dropdown clicks, and choosing plays a click from the `change` event, so a
   choice is not silent — but it is one sound where a picker built from buttons would give two.
3. **Loading states.** `LoadingOverlay` and the button spinners are silent on purpose: they are not actions, and a
   sound on every refresh wave would be constant. The wave's *completion* is already a toast.
4. **The login screen's announcement popup.** An announcement shown before sign-in is a panel rather than a toast.
   If it should announce itself audibly that is one `notification.mp3` call — plus a decision about whether a
   department notice should make a noise at an unattended station terminal.
5. **The mobile drawer sliding open.** The hamburger and the backdrop click (both covered), but the drawer itself
   has no sound. A short swish would suit it, and nothing in the current set is right for one.
6. **Signature drawing (Training) and drag-select (Availability).** Free-hand input, where every stroke would
   click. A dedicated sound played once when the gesture *ends* is the only sensible shape for it.
