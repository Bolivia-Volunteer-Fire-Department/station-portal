# Authentication Security

How member passwords are stored, how sign-in attempts are throttled, and how to
verify both. All of this lives in the Apps Script backend (`src/services/Code.gs`),
which is gitignored — paste the current version into your project and redeploy
after updating it.

## What changed, and why

Two pre-existing weaknesses were addressed:

| Before | After |
| --- | --- |
| Passwords were compared as plain text straight from the `users` sheet. Anyone who saw the spreadsheet (or a backup, or a shared copy) had every member's password. | Passwords are stored as PBKDF2-HMAC-SHA256 hashes with a unique salt per member. The sheet no longer holds a recoverable secret. |
| `LOGIN` accepted unlimited attempts, so a password could be guessed by brute force. | Failed attempts lock the username out with an escalating delay, and a global cap stops a flood spread across many usernames. |

## Password storage format

```
pbkdf2-sha256$<iterations>$<saltBase64>$<digestBase64>
```

- **Algorithm:** PBKDF2 (RFC 8018) with HMAC-SHA256, a 16-byte random salt, and a
  32-byte derived key. Each hash carries its own iteration count, so the count can
  be raised later without invalidating existing passwords — old hashes verify with
  their recorded count and are upgraded on the member's next successful sign-in.
- **Why build it by hand?** Apps Script has no bcrypt, no Argon2 and no native
  PBKDF2. The only cryptographic primitive available is
  `Utilities.computeHmacSha256Signature`, so key stretching is built from it.
- **Timing:** the digest is always compared with a length-independent comparison
  (no early exit), and a *dummy* verification runs when the username does not exist
  or its password cell is unusable, so response time does not reveal whether an
  account exists.

## Cost, and how to tune it

Each PBKDF2 iteration is one Apps Script-to-Java bridge call, which is why the
default is deliberately modest. Measure before changing it:

1. In the Apps Script editor, run **`benchmarkPasswordHashing`** — it logs
   milliseconds per password verification at the current setting.
2. Run **`suggestPbkdf2Iterations`** — it measures your project and suggests a
   count that fits a time budget (default 250 ms).
3. Apply the result in **Project Settings → Script Properties** as
   `PBKDF2_ITERATIONS` (the value is clamped to 100–20,000). Existing hashes are
   unaffected; new ones use the new count.

The default is 600 iterations. Verification happens once per sign-in, so the added
cost is a single one-off delay — the rest of the login (session creation, the
member data fetches) is unchanged.

## Upgrading an existing deployment

1. Paste the updated `Code.gs` into the Apps Script editor and **Deploy → Manage
   deployments → New version**.
2. Run **`diagnoseAuthSecurity`** and read the log. It reports the iteration count,
   the measured cost, how many rows are still plain text, and whether
   `CacheService`/`LockService` are reachable.
3. Run **`migrateLegacyPasswords`** to hash every remaining plain-text row in one
   pass. It is safe to re-run — already-hashed rows are skipped.
4. Belt and braces: legacy rows are *also* upgraded automatically the first time
   each member signs in, so nobody is locked out if step 3 is missed.

**Nothing is required from members.** They sign in with the same password as before.


## Sign-in throttling

| Setting | Default | Meaning |
| --- | --- | --- |
| `LOGIN_MAX_FAILURES` | 5 | Failures before the first lock |
| `LOGIN_LOCK_BASE_SECONDS` | 60 | First lock duration |
| `LOGIN_LOCK_MAX_SECONDS` | 900 | Ceiling for the escalating lock |
| `LOGIN_FAILURE_WINDOW_SECONDS` | 900 | Rolling window for per-username counts |
| `LOGIN_GLOBAL_MAX_FAILURES` | 200 | Failures across all usernames before a site-wide refusal |
| `LOGIN_GLOBAL_WINDOW_SECONDS` | 900 | Window for the global counter |

Behaviour:

- Lock duration doubles every additional `LOGIN_MAX_FAILURES` failures, capped at
  `LOGIN_LOCK_MAX_SECONDS`.
- Counters are keyed on the **submitted username**, existing or not, so a lockout
  message cannot be used to discover which usernames are real.
- A successful sign-in clears that username's counter and lock. The global counter
  is deliberately *not* cleared by a success, since that would let an attacker
  alternate guesses with a known-good login to reset their own throttle.
- The blocked response includes `code: "RATE_LIMITED"` and `retry_after` (seconds).
  The login screen shows the message as-is.
- **Fail-open:** if `CacheService` or `LockService` is unavailable, attempts are
  allowed rather than blocked, so an outage cannot lock every member out.
- **Best-effort:** cache entries can be evicted early, so this throttles sustained
  guessing rather than guaranteeing an exact attempt count.
- Blocked attempts go to the Apps Script execution log (**View → Logs**), not the
  System Log sheet, so that a flood cannot consume sheet write quota. The failures
  leading up to a lock are still recorded as `LOGIN_FAILED` in the System Log.

## Verification

```bash
npm run verify:auth
```

This extracts the real hashing and throttling functions out of `Code.gs`, runs them
with stubs for the Apps Script globals, and checks PBKDF2 output against Node's
`crypto.pbkdf2Sync` and the published PBKDF2-HMAC-SHA256 test vectors. It covers the
stored format, legacy upgrade behaviour, blank and corrupted cells, constant-time
comparison, iteration clamping, lockout timing and escalation, enumeration
resistance, and fail-open behaviour — 84 checks.

## Behaviour changes worth knowing

- **Passwords are no longer trimmed.** The hash must see exactly what was stored,
  and trimming silently would have locked out anyone whose password contains
  leading or trailing spaces. A password of `" abc "` is now different from `"abc"`.
- **A blank password cell can no longer authenticate.** Previously an empty cell
  plus an empty submitted password would sign in as that member. Blank cells now
  never match, and `UPDATE_USER_PASSWORD` refuses to write an empty password so a
  member cannot be locked out that way by accident.
- **`ADMIN_SAVE_USER` hashes whatever password the admin supplies.** Pasted or
  typed, it is stored as a hash.

## Remaining recommendations

- **Use passphrases.** PBKDF2 at these iteration counts is much weaker than
  bcrypt/Argon2 on a native runtime; password length is the compensating control.
- **Consider Google SSO.** Verifying a Google ID token server-side would remove
  password storage from the app entirely, which is the only way to fully close this
  class of risk.
- **Keep the spreadsheet private.** Hashing protects the passwords, but the sheet
  still holds every member's `fcm_token`, availability and schedule data.
- **Add a password policy** (minimum length, no reuse) if members are choosing weak
  passwords; there is deliberately no complexity rule today.
