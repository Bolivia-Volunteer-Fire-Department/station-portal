// THE STATION'S WELCOME: `intro_short.mp3`, played as the app becomes usable after somebody signs in.
//
// ON EVERY SIGN-IN, and that is a decision rather than a leftover. This sound used to play once per DEVICE, which is the right
// rule for a member's own phone and the wrong one for the machine a whole station signs into: the first person to sign in on
// that tablet heard the station's welcome, and nobody ever heard it again - including them. A welcome on arrival is what a
// fire station wants, and a station is a place people arrive at all day.
//
// THE GESTURE RULE IS THE PART THAT DOES NOT MOVE, and it is a fact about browsers rather than a preference: a page may only
// make a sound shortly after somebody has touched it. A sign-in is a touch - the click on the form - so the welcome rides on
// it happily. A session RESTORED from a token has no click behind it, so a browser would refuse the sound and the code would
// believe it had played something while the member heard nothing. That is why this counts SIGN-INS rather than asking whether
// somebody is signed in: being signed in is not the same as having just done it.
//
// The boot screen is waited for rather than talked over: `ready` is false while the app is still loading its first data, and a
// chime under a spinner is noise.
//
// (`fireClock.introHeard`, the localStorage key the per-device version wrote, is read by nothing now. It can be left where it
// is - nothing will notice it - and this note is so the next person to find it in devtools does not go looking.)
//
// The decision is PURE, so a Node harness (scripts/verify-sounds.mjs) can ask it directly. That is how the rule survives being
// edited later: the cases are written down as calls rather than described in a comment.
//
// `signIns` counts the sign-ins this page load has seen and `welcomed` counts the ones the station has already played for, so
// the welcome is owed while there is a sign-in that has not had one - which is also what stops React running the effect twice
// from playing two overlapping copies of the same sound.
export const welcomeIsOwed = ({ signIns = 0, welcomed = 0, ready = false } = {}) => signIns > welcomed && ready;
