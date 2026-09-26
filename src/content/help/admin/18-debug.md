Fires the portal's own notifications, dialogs and sounds from buttons, so they can be checked without waiting for the thing that normally triggers them.

> [!IMPORTANT]
> Access to this area requires the **Access the debug page** role permission.

Most of what the app tells you is hard to check on demand. A toast appears for a second after a save, so "it said nothing happened" can only be answered by saving something again. A session has to expire before the re-authentication prompt appears. A clock refusal has to be earned by standing in the wrong place. Each button here does one of those instead.

## Toasts

| Button | What you should see and hear |
|---|---|
| **success** | A green toast, with the success sound |
| **error** | A red toast, with the error sound |
| **info** / **warning** | The matching toast. A warning uses the error sound, as in the rest of the app |
| **message** | The plain toast, with the normal sound |
| **loading** | The spinner toast, which turns into a **success** toast about two seconds later |
| **push notification** | What a push looks like when the app is already open, with the notification sound |
| **dismiss them all** | Clears every toast on screen |

**Use a long message** swaps the short wording for a deliberately long one. That is the case worth looking at on a phone: whether a long message wraps, and whether the dismiss button is still reachable.

## Dialogs

Each button opens one of the app's real dialogs, which opens on its own tone:

- **Confirmation, destructive** — the delete/remove dialog, with the red button.
- **Confirmation, not a warning** — the same dialog where nothing is being destroyed. Only the button color differs.
- **Clock refused: too far away** — a clock action refused on location, with the distance and the limit.
- **Clock refused: no location** — what a member sees when the browser will not give their position.
- **Session expired** — the re-authentication prompt, including the small line naming the request that was refused.
- **Forced password change** — the prompt a member sees when they must choose a new password.
- **Loading overlay (3s)** — the "Please Wait" shade, saying this station's own loading message.

> [!NOTE]
> **The buttons inside these dialogs do not do anything.** A preview has no session and no password behind it, so the prompts that normally submit report a refusal and close instead. Nothing on this page can change a row.

## Sounds

One button per sound file the app ships: `click`, `click_double`, `modal_positive`, `modal_error`, `notification`, `sound_on`, `sound_off`, `toast_success`, `toast_error`, `toast_normal`.

These buttons play **even when sounds are switched off** — which is the point, because "the app is silent" is usually a setting rather than a fault — and the buttons themselves make no sound, so what you hear is the sample and nothing else.

> [!NOTE]
> A sound is fetched the first time it is played and then served from memory, so the first press of a sound you have not heard yet is the one that touches the network.

### Levels

Each sound has a slider for how loud the app plays it. The row shows the level in force, what that sound ships at, and where the shipped level comes from — `click` has its own, and the one-shot sounds share a default of 40%.

- **Move a slider** and the level applies straight away, everywhere the app plays that sound, not just on this page. The sample plays when you let the handle go, so each position can be heard as you try it.
- **reset** appears on a row once it has been moved, and puts that one sound back. **reset all levels** puts everything back at once.
- The levels are **temporary**. Nothing is saved to the sheet, and every one of them returns to the app's own mix when the session ends — whether you sign out or it times out. That is deliberate: a level is something to try, and the next person to sign in on this machine should not inherit somebody's experiment.

> [!NOTE]
> These sliders are for finding the right level, not for setting it. If a level should change for everyone, the number has to be changed in the app's code — so note the percentage you landed on and tell Matt.

## When to reach for this page

- **"I saved it and nothing happened."** Fire the toasts and confirm the app can show one at all, then check the sound for that kind.
- **"The app makes no noise."** Open **User Settings** and check the sounds switch, then play a sound here: if it plays, the app is working and the setting is off.
- **"The click is too loud"** (or too quiet). Move that sound's level slider until it sounds right, then note the percentage — making it permanent is a code change, and the levels themselves are temporary.
- **"What does a refused clock-in look like?"** Open it here rather than walking outside with a phone.
- **"The session expired and I lost my work."** Show the re-authentication prompt, and the forced password change beside it, to whoever needs to see what the member was looking at.
