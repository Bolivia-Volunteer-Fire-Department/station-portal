// MAIN ENTRY POINT

// Session tokens: a random token is minted at login and required on all
// member/admin endpoints. Identity & permissions are derived from the token
// (never from client-supplied user ids), so a leaked script URL can't be used
// to impersonate someone or skip admin checks.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours (legacy default; see sessionTtlMs)

// Firefighter Runner leaderboard (the easter-egg game).
//
// Scores ride along on the `users` sheet's `runner_score` column, so they are readable by
// any signed-in member the same way the roster is. Only personal bests are stored, and a
// score is only ever WRITTEN when it beats the one already there.
const RUNNER_LEADERBOARD_LIMIT = 25; // rows sent to the client
const RUNNER_SCORE_MAX = 100000; // guard rail against a doctored request

// Apps Script replies to the very first fetch of a deployment with a 302
// redirect that browsers follow as a GET - dropping the POST body and, without
// a handler here, responding without CORS headers. That surfaces in the client
// console as "No 'Access-Control-Allow-Origin' header" + net::ERR_FAILED.
// Returning a ContentService JSON payload (Apps Script serves ContentService
// output with Access-Control-Allow-Origin) lets the redirect chain complete
// cleanly; the client detects the marker below and re-sends its original
// action to the now-warmed URL.
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, redirected: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Actions that only READ. They skip the script lock, so a refresh wave runs concurrently rather than
// queueing behind whatever write is in flight.
//
// Adding one is a claim that the action touches no cell, mints no session and appends no log row -
// scripts/verify-refresh-wiring.mjs checks that claim against the action's own body and fails the audit if
// a write call appears in one of these.
var READ_ONLY_ACTIONS = {
  // The refresh wave: what every admin save reloads in the background, and what sign-in loads.
  GET_INITIAL_DATA: true,
  ADMIN_GET_USERS: true,
  ADMIN_GET_SCHEDULE_TEMPLATES: true,
  ADMIN_GET_SCHEDULE_OFFERS: true,
  GET_SCHEDULE: true,
  GET_ROSTER: true,
  GET_ON_DUTY: true,
  GET_TRAINING: true,
  MY_ANNOUNCEMENTS: true,
  GET_EVENTS: true,
  // The tabs that fetch their own list when opened. GET_TRAINING already appears above: one action serves
  // both the member module and the administration report.
  ADMIN_GET_ANNOUNCEMENTS: true,
  ADMIN_GET_EVENTS: true,
  ADMIN_GET_SYSTEM_LOG: true,
  ADMIN_GET_FCM_STATUS: true,
  ADMIN_GET_PUSH_STATUS: true,
};

// How long a WRITE waits for the script lock before giving up.
//
// It used to wait 10 seconds and then run the write ANYWAY, unlocked: `locked` was only consulted to decide
// whether to release it, so a timed-out wait silently downgraded a serialised write to a racing one. Two
// writers that overlap can lose one of the two updates, so failing to take the lock is now a refusal the
// caller can retry rather than a silent risk.
//
// Longer than any single save holds it, including a bulk schedule write. scripts/verify-write-safety.mjs
// drives both halves of this: a refused write must leave the sheet completely untouched.
const WRITE_LOCK_WAIT_MS = 20000;

// Actions allowed to run WITHOUT the lock when it cannot be taken.
//
// Empty on purpose: a lost update is never free, and every caller already reports a failed action as an error.
// The seam exists so a genuinely harmless exception - a personal best on the runner leaderboard, say - can be
// named here rather than reopening the general rule.
var LOCK_OPTIONAL_ACTIONS = {};

// Does this action need the script lock? Reads never do, which is what lets a save's ten-request refresh wave
// run concurrently instead of queueing behind the next write.
function actionNeedsWriteLock(action) {
  if (READ_ONLY_ACTIONS[String(action)] === true) return false;
  return LOCK_OPTIONAL_ACTIONS[String(action)] !== true;
}

// Takes the lock for a write, or says how long to wait before trying again.
//
// The caller MUST refuse the action when this comes back not-ok, without touching the sheet. The refusal is
// only honest if it writes nothing at all - no cell, no log row, no session property - because writing is
// precisely what could not be serialised.
function acquireWriteLock(lock, action) {
  if (!actionNeedsWriteLock(action)) return { ok: true, took: false };
  if (lock.tryLock(WRITE_LOCK_WAIT_MS)) return { ok: true, took: true };
  return { ok: false, retryAfterSeconds: Math.max(1, Math.round(WRITE_LOCK_WAIT_MS / 2000)) };
}

// The reply a refused write gets. `code` is the vocabulary the client already reads (RATE_LIMITED,
// UNAUTHORIZED, UNKNOWN_ACTION) and `retry_after` is in seconds, as it is on the rate-limited login reply.
function busyResponseData(retryAfterSeconds) {
  return {
    success: false,
    code: "BUSY",
    retry_after: retryAfterSeconds,
    message:
      "The station portal is busy saving something else, so your change was NOT saved. " +
      "Please try again in a moment."
  };
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    const payload = data.payload || {};

    // The lock is taken for WRITES only.
    //
    // Apps Script runs a script's executions concurrently, but this lock serialised every request - and a
    // refresh wave is ten requests, so a save's background reloads crawled through one at a time behind
    // whatever write was in flight. Reads hold nothing, so they now run together and the wave finishes in
    // about the time of its slowest request.
    //
    // The safety of this rests on one rule, enforced by scripts/verify-refresh-wiring.mjs: an action listed
    // in READ_ONLY_ACTIONS must contain NO write call. Anything that appends a log row, mints a session,
    // prunes a token or touches a cell belongs on the other side of this line.
    //
    // A write that cannot take the lock is REFUSED, not run unlocked - see acquireWriteLock and
    // scripts/verify-write-safety.mjs, which asserts that the refusal writes nothing.
    const gate = acquireWriteLock(lock, action);
    locked = gate.ok && gate.took;
    if (!gate.ok) {
      // Returns inside the try, so the finally below still runs - with `locked` false, so nothing is released
      // that was never taken.
      return ContentService
        .createTextOutput(JSON.stringify(busyResponseData(gate.retryAfterSeconds)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let responseData = { success: false, message: "Invalid action" };

    switch (action) {

      case "GET_INITIAL_DATA":
        // Everything returned here is world-readable: this action is
        // deliberately unauthenticated (the login screen needs it) and the
        // deployment URL is public, so credentials and per-device identifiers
        // are stripped by the two helpers below.
        //
        // Full user directory is intentionally NOT returned here either - it's
        // only fetched on demand for admins via ADMIN_GET_USERS, to avoid
        // shipping the entire roster to unauthenticated clients.
        responseData = {
          roles: getSheetData(ss, "roles"),
          ranks: getSheetData(ss, "ranks"),
          shifts: getShiftsData(ss),
          systemSettings: publicSystemSettings(ss),
          userSettings: publicUserSettings(ss),
          // The login screen's announcements. Restricted to the ones aimed at EVERYONE: at this point there
          // is no session, so a role-, rank- or member-targeted announcement cannot be resolved - and
          // showing it anyway would leak it to whoever is standing at the keyboard. Targeted announcements
          // reach their reader through MY_ANNOUNCEMENTS once they are signed in.
          announcements: announcementRowsFor(ss, {
            locations: ["is_visible_on_login"],
            everyoneOnly: true
          })
        };
        break;

      case "LOGIN": {
        // Authenticate against the typed username rather than a preloaded user list
        const targetUsername = String(data.username || payload.username || data.user_name || payload.user_name || "").trim();
        // Passwords are deliberately NOT trimmed: the hash must see exactly what
        // was stored, and quietly stripping whitespace would lock out any member
        // whose password legitimately starts or ends with a space.
        const targetPassword = String(data.password || payload.password || "");

        // Cheapest possible gate, and it runs before the users sheet is read, so
        // a blocked attempt costs almost nothing.
        const rateLimit = checkLoginRateLimit(targetUsername);
        if (!rateLimit.allowed) {
          // Deliberately not written to the System Log sheet: a blocked attempt
          // costs almost nothing, so an attacker could otherwise burn through
          // sheet write quota by hammering. The failures that led to the lock are
          // already recorded as LOGIN_FAILED, and these show up in the Apps Script
          // execution log (View > Logs) instead.
          Logger.log("LOGIN_BLOCKED username=" + (targetUsername || "Unknown") +
            " retry_after=" + rateLimit.retryAfterSeconds + "s scope=" + rateLimit.scope);
          responseData = {
            success: false,
            code: "RATE_LIMITED",
            retry_after: rateLimit.retryAfterSeconds,
            message: loginRateLimitMessage(rateLimit.scope, rateLimit.retryAfterSeconds)
          };
          break;
        }

        const loginUsers = getSheetData(ss, "users");
        
        // Find user by matching user_name (case-insensitive)
        const foundUser = loginUsers.find(function(u) {
          return String(u.user_name || "").trim().toLowerCase() === targetUsername.toLowerCase();
        });

        let passwordOk = false;
        let needsRehash = false;
        let storedState = "unknown_user";

        if (foundUser) {
          const check = verifyPasswordValue(foundUser.password, targetPassword);
          passwordOk = check.ok;
          needsRehash = check.needsRehash;
          storedState = check.reason;
        }

        // Spend the same key-derivation work as a real account when there is
        // nothing to verify against, so response time cannot be used to work out
        // whether a username exists, or which rows have unusable password cells.
        if (!foundUser || storedState === "blank" || storedState === "malformed_hash") {
          dummyPasswordVerification_(targetPassword);
        }

        if (passwordOk) {
          var sanitizedUser = Object.assign({}, foundUser);
          delete sanitizedUser.password; // Do not send back hashed/plain password

          cleanupExpiredSessions();
          recordLoginSuccess(targetUsername);

          responseData = { success: true, user: sanitizedUser, token: createSession(foundUser.id, ss) };

          // Upgrade a legacy plain-text row now that the password is known to be
          // right, so the sheet stops holding a recoverable secret without
          // locking anyone out. This happens once per member.
          if (needsRehash) {
            try {
              storePasswordHash(ss, foundUser.id, targetPassword);
            } catch (err) {
              Logger.log("Could not upgrade stored password hash for " + foundUser.id + ": " + err.toString());
            }
          }

          logSystemEvent(
            ss, 
            foundUser.id, 
            "USER_LOGIN", 
            "User logged in successfully."
          );
        } else {
          const failure = recordLoginFailure(targetUsername);

          responseData = failure.locked ? {
            success: false,
            code: "RATE_LIMITED",
            retry_after: failure.retryAfterSeconds,
            message: loginRateLimitMessage("account", failure.retryAfterSeconds)
          } : { 
            success: false, 
            message: "Invalid username or password." 
          };

          logSystemEvent(
            ss, 
            targetUsername || "Unknown", 
            "LOGIN_FAILED", 
            "Failed login attempt for username: " + (targetUsername || "Unknown") +
              (failure.locked ? " (locked for " + failure.retryAfterSeconds + "s)" : "")
          );
        }
        break;
      }

      case "GET_TIMECLOCK_LOGS": {
        const authLogs = getAuthContext(ss, data);
        if (!authLogs) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        responseData = { logs: getSheetData(ss, "timeclock") };
        break;
      }

      case "GET_SCHEDULE": {
        const authSchedule = getAuthContext(ss, data);
        if (!authSchedule) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        responseData = {
          schedule: getSheetData(ss, "schedule"),
          // Reference data the member calendar needs: assignment names for the
          // pill labels, the admin-chosen colour, and the minimum rank so open
          // shifts the member may not fill are not offered to them. See
          // memberAssignmentRows for what is (and is not) projected.
          assignments: memberAssignmentRows(ss),
          // The weekly pattern itself, so a member's calendar can label a shift with
          // its window and its nickname and list the template slots nobody has filled.
          // See memberScheduleTemplateRows for the projection.
          scheduleTemplates: memberScheduleTemplateRows(ss)
        };
        break;
      }

      case "GET_AVAILABILITY": {
        const authAvail = getAuthContext(ss, data);
        if (!authAvail) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        responseData = { availability: getSheetData(ss, "availability") };
        break;
      }

      case "SET_MY_AVAILABILITY": {
        const authAvailSave = getAuthContext(ss, data);
        if (!authAvailSave) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        // Gated on the same permission as the My Availability module itself.
        if (!hasRolePermission(ss, authAvailSave.userId, "can_edit_own_availability")) {
          responseData = { success: false, message: "Your role cannot set its own availability." };
          break;
        }

        // Applies every change the member made in this visit in ONE request. The member
        // always comes from the session token, never the payload; the rows themselves are
        // built by setAvailabilityRows, which takes the assignment from the template.
        const myAvailResult = setAvailabilityRows(
          ss,
          authAvailSave.userId,
          data.adds || payload.adds,
          data.removes || payload.removes
        );
        if (!myAvailResult.ok) {
          responseData = { success: false, message: myAvailResult.message };
          break;
        }

        responseData = {
          success: true,
          added: myAvailResult.added,
          cleared: myAvailResult.cleared,
          skipped: myAvailResult.skipped
        };
        logSystemEvent(
          ss,
          authAvailSave.userId,
          "SET_MY_AVAILABILITY",
          "Member saved availability: +" + myAvailResult.added + " -" + myAvailResult.cleared +
            (myAvailResult.skipped ? " (" + myAvailResult.skipped + " skipped)" : "")
        );
        break;
      }

      case "MY_ANNOUNCEMENTS": {
        // The announcements aimed at the signed-in member, for the dashboard and the sidebar.
        //
        // The audience is resolved from the SESSION, never from the payload: otherwise a member could ask
        // for the announcements aimed at somebody else by sending their id.
        const authAnn = getAuthContext(ss, data);
        if (!authAnn) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        const annViewer = findRowById(getSheetData(ss, "users"), authAnn.userId) || {};
        responseData = {
          success: true,
          announcements: announcementRowsFor(ss, {
            roleId: annViewer.role_id,
            rankId: annViewer.rank_id,
            userId: authAnn.userId,
            // Login-screen announcements are served publicly with GET_INITIAL_DATA; including them here
            // as well would show them twice for a signed-in member.
            locations: ["is_visible_on_dashboard", "is_visible_on_sidebar"]
          })
        };
        break;
      }

      case "ADMIN_GET_ANNOUNCEMENTS": {
        const authAnnList = getAuthContext(ss, data);
        if (!authAnnList || !hasRolePermission(ss, authAnnList.userId, "can_make_announcements")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }
        // Every announcement, newest first, for the tab's list. No audience filtering: the administrator
        // editing them needs to see all of them.
        responseData = {
          success: true,
          announcements: getSheetData(ss, "announcements").slice().sort(function (a, b) {
            const aFrom = toDateKeyValue(a.effective_date);
            const bFrom = toDateKeyValue(b.effective_date);
            if (aFrom !== bFrom) return aFrom < bFrom ? 1 : -1;
            return String(b.id) > String(a.id) ? 1 : -1;
          })
        };
        break;
      }

      case "ADMIN_SAVE_ANNOUNCEMENT": {
        const authAnnSave = getAuthContext(ss, data);
        if (!authAnnSave || !hasRolePermission(ss, authAnnSave.userId, "can_make_announcements")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const annFields = announcementFieldsFrom(data, payload);
        const annProblem = announcementValidationError(annFields, getSheetData(ss, "users"));
        if (annProblem) {
          responseData = { success: false, message: annProblem };
          break;
        }

        // The author is stamped from the session and never taken from the payload, so it cannot be
        // forged or edited afterwards.
        const annId = String(annFields.id || "");
        const isNewAnnouncement = annId === "";
        if (isNewAnnouncement) {
          annFields.author_user_id = authAnnSave.userId;
        } else {
          delete annFields.author_user_id;
        }

        const savedAnnouncementId = upsertSheetRowById(ss.getSheetByName("announcements"), annFields);
        responseData = {
          success: true,
          id: savedAnnouncementId,
          push: annFields.is_send_push_notification ? sendAnnouncementPush(ss, annFields) : null
        };

        logSystemEvent(
          ss,
          authAnnSave.userId,
          "ADMIN_SAVE_ANNOUNCEMENT",
          (isNewAnnouncement ? "Created" : "Updated") + " announcement " + savedAnnouncementId
        );
        break;
      }

      case "ADMIN_DELETE_ANNOUNCEMENT": {
        const authAnnDel = getAuthContext(ss, data);
        if (!authAnnDel || !hasRolePermission(ss, authAnnDel.userId, "can_make_announcements")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }
        const announcementIdToDelete = String(data.id || payload.id || "");
        if (!announcementIdToDelete) {
          responseData = { success: false, message: "No announcement was named." };
          break;
        }
        const deletedAnnouncements = deleteSheetRowById(ss.getSheetByName("announcements"), announcementIdToDelete);
        responseData = { success: true, deleted: deletedAnnouncements };
        logSystemEvent(ss, authAnnDel.userId, "ADMIN_DELETE_ANNOUNCEMENT", "Deleted announcement " + announcementIdToDelete);
        break;
      }

      // --- Events ------------------------------------------------------------
      //
      // Read by every signed-in member (a calendar is useless if half the crew cannot see it), written
      // only by a role holding can_create_events.

      case "GET_EVENTS": {
        const authEvents = getAuthContext(ss, data);
        if (!authEvents) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        const eventViewer = findRowById(getSheetData(ss, "users"), authEvents.userId) || {};
        responseData = { success: true, events: eventsForViewer(ss, eventViewer, authEvents.userId) };
        break;
      }

      case "ADMIN_GET_EVENTS": {
        const authEventList = getAuthContext(ss, data);
        if (!authEventList || !hasRolePermission(ss, authEventList.userId, "can_create_events")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }
        // The whole sheet, unfiltered: an administrator has to be able to edit an event aimed at someone
        // else, which the member view deliberately hides from them.
        responseData = { success: true, events: getSheetData(ss, "events") };
        break;
      }

      case "ADMIN_SAVE_EVENT": {
        const authEventSave = getAuthContext(ss, data);
        if (!authEventSave || !hasRolePermission(ss, authEventSave.userId, "can_create_events")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const eventFields = eventFieldsFrom(data, payload);
        const eventProblem = eventValidationError(eventFields);
        if (eventProblem) {
          responseData = { success: false, message: eventProblem };
          break;
        }

        // The author is stamped from the session on create and dropped on update, so it cannot be forged
        // nor reassigned - which is what lets the administration screen reveal it truthfully.
        const isNewEvent = String(eventFields.id || "") === "";
        if (isNewEvent) {
          eventFields.author_user_id = authEventSave.userId;
        } else {
          delete eventFields.author_user_id;
        }

        const savedEventId = upsertSheetRowById(ss.getSheetByName("events"), eventFields);
        responseData = { success: true, id: savedEventId };
        logSystemEvent(
          ss,
          authEventSave.userId,
          "ADMIN_SAVE_EVENT",
          (isNewEvent ? "Created" : "Updated") + " event " + savedEventId
        );
        break;
      }

      case "ADMIN_DELETE_EVENT": {
        const authEventDel = getAuthContext(ss, data);
        if (!authEventDel || !hasRolePermission(ss, authEventDel.userId, "can_create_events")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }
        const eventIdToDelete = String(data.id || payload.id || "").trim();
        if (!eventIdToDelete) {
          responseData = { success: false, message: "No event was named." };
          break;
        }
        const deletedEvents = deleteSheetRowById(ss.getSheetByName("events"), eventIdToDelete);
        responseData = { success: true, deleted: deletedEvents };
        logSystemEvent(ss, authEventDel.userId, "ADMIN_DELETE_EVENT", "Deleted event " + eventIdToDelete);
        break;
      }

      case "ADMIN_GET_SYSTEM_LOG": {
        // Read-only, but still permission-gated and still session-gated: the log names members and
        // records failed sign-ins, so it is not something to hand to anyone who asks.
        const authSysLog = getAuthContext(ss, data);
        if (!authSysLog) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        if (!hasRolePermission(ss, authSysLog.userId, "can_view_system_log")) {
          responseData = {
            success: false,
            message: "Reading the system log requires the 'View the system log' permission."
          };
          break;
        }

        // One page at a time - the filter, sort and page all come from the request and the response
        // carries only the rows for that page. See systemLogPage.
        responseData = Object.assign({ success: true }, systemLogPage(ss, data));
        break;
      }

      case "PING": {
        // Refreshes the session window and nothing else. The client uses this for "Stay signed in"
        // on the idle warning: without it that button would only reset a local timer while the
        // server session quietly lapsed, and the next action would fail with a re-authentication
        // prompt that looked random.
        const authPing = getAuthContext(ss, data);
        responseData = authPing
          ? { success: true }
          : { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
        break;
      }

      case "GET_ON_DUTY": {
        const authDuty = getAuthContext(ss, data);
        if (!authDuty) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }

        // Minimal, non-sensitive roster of currently clocked-in users (no passwords/usernames/roles)
        const timeclockRows = getSheetData(ss, "timeclock");
        const allUsersForDuty = getSheetData(ss, "users");

        const onDutyUserIds = new Set(
          timeclockRows
            .filter(function (log) { return !log.time_out; })
            .map(function (log) { return String(log.user_id); })
        );

        const onDutyUsers = allUsersForDuty
          .filter(function (u) { return onDutyUserIds.has(String(u.id)); })
          .map(function (u) { return { id: u.id, name: u.name, rank_id: u.rank_id }; });

        responseData = { onDuty: onDutyUsers };
        break;
      }

      case "GET_ROSTER": {
        const authRoster = getAuthContext(ss, data);
        if (!authRoster) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }

        // Minimal, non-sensitive roster available to every signed-in member
        // (no passwords/usernames/roles/status). The schedule sheet only stores
        // user ids, so members need this to label other people's shifts - the
        // same projection already exposed through GET_ON_DUTY.
        const rosterUsers = getSheetData(ss, "users")
          .filter(function (u) { return u && u.id !== "" && u.id !== undefined && u.id !== null; })
          .map(function (u) { return { id: u.id, name: u.name, rank_id: u.rank_id }; });

        responseData = { roster: rosterUsers };
        break;
      }

      case "GET_RUNNER_LEADERBOARD": {
        const authRunner = getAuthContext(ss, data);
        if (!authRunner) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }

        // The game is an easter egg rather than a station tool, so this needs a session but
        // no permission: anyone who can play can see the board. The projection is minimal -
        // an id (to highlight your own row), a name and a score.
        const runnerBoard = runnerLeaderboard(ss);

        responseData = {
          leaderboard: runnerBoard.rows,
          total: runnerBoard.total
        };
        break;
      }

      case "SAVE_RUNNER_SCORE": {
        const authRunnerSave = getAuthContext(ss, data);
        if (!authRunnerSave) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }

        // A users sheet without the column would take the write and silently drop it, so say
        // so instead of reporting a save that never happened.
        const runnerUsersSheet = ss.getSheetByName("users");
        const runnerUserHeaders = runnerUsersSheet
          ? (runnerUsersSheet.getDataRange().getValues()[0] || [])
          : [];
        if (runnerUserHeaders.indexOf("runner_score") === -1) {
          responseData = { success: false, message: "The users sheet has no runner_score column." };
          break;
        }

        // Personal bests only, and only ever upwards: runnerScoreToStore clamps the
        // client-supplied score and returns null unless it beats what is already there.
        const runnerUser = findRowById(getSheetData(ss, "users"), authRunnerSave.userId);
        const runnerPrevious = runnerUser ? Number(runnerUser.runner_score) || 0 : 0;
        const runnerBest = runnerScoreToStore(runnerPrevious, data.score);

        if (runnerBest === null) {
          responseData = { success: true, best: runnerPrevious, improved: false };
          break;
        }

        upsertSheetRowById(ss.getSheetByName("users"), {
          id: authRunnerSave.userId,
          runner_score: runnerBest
        });

        responseData = { success: true, best: runnerBest, improved: true };
        logSystemEvent(ss, authRunnerSave.userId, "SAVE_RUNNER_SCORE", "Runner personal best " + runnerBest);
        break;
      }

      case "GET_SHIFT_OFFERS": {
        const authOffers = getAuthContext(ss, data);
        if (!authOffers) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }

        // A member only ever sees their own offers - the whole table stays
        // admin-only (see ADMIN_GET_SCHEDULE_OFFERS).
        responseData = { success: true, offers: offersForUser(ss, authOffers.userId) };
        break;
      }

      case "SUBMIT_SHIFT_OFFER": {
        const authOffer = getAuthContext(ss, data);
        if (!authOffer) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        // The My Schedule pills are not clickable without this, so the call should
        // not succeed either.
        if (!hasRolePermission(ss, authOffer.userId, "can_make_offers")) {
          responseData = { success: false, message: "Your role cannot offer to fill shifts." };
          break;
        }

        // The offering member always comes from the session token, never the payload.
        const offerFields = readShiftOfferFields(data);
        if (!offerFields.date_from || !offerFields.assignment_id) {
          responseData = { success: false, message: "That shift is missing its date or assignment." };
          break;
        }
        if (offerFields.date_from < todayDateKey()) {
          responseData = { success: false, message: "That shift is already in the past." };
          break;
        }

        // Rank rule (mirrors utils/rankEligibility.js on the client) is enforced
        // server-side too so a crafted request can't offer on a shift the member
        // couldn't be scheduled into anyway.
        const offerAssignment = findRowById(getSheetData(ss, "assignments"), offerFields.assignment_id);
        if (!offerAssignment) {
          responseData = { success: false, message: "That assignment no longer exists." };
          break;
        }
        const offerUser = findRowById(getSheetData(ss, "users"), authOffer.userId);
        if (!canUserFillAssignment(ss, offerUser, offerAssignment)) {
          responseData = { success: false, message: "Your rank doesn't qualify for this assignment." };
          break;
        }

        const offerSheet = ss.getSheetByName("schedule_offers");
        if (!offerSheet) {
          responseData = { success: false, message: "The schedule_offers sheet is missing." };
          break;
        }

        // The shift has to still be unfilled; a filled one can't be offered on.
        const openSlot = resolveOpenShift(ss, offerFields);
        if (!openSlot.ok) {
          responseData = { success: false, message: openSlot.message };
          break;
        }
        offerFields.schedule_id = openSlot.scheduleId;

        // One pending offer per member per shift, so double-clicks and retries
        // never stack duplicates into the sheet.
        const existingOffer = offersForUser(ss, authOffer.userId).find(function (o) {
          return o.status === "pending" && o.slot_key === slotKeyOfOffer(offerFields);
        });
        if (existingOffer) {
          responseData = { success: true, offer: existingOffer, duplicate: true, message: "You already offered to fill this shift." };
          break;
        }

        const offerId = upsertSheetRowById(offerSheet, Object.assign({}, offerFields, {
          id: "",
          user_id: String(authOffer.userId),
          approved_by: "",
          declined_by: ""
        }));

        const savedOffer = normalizeOffer(findRowById(getSheetData(ss, "schedule_offers"), offerId));
        // Notification seam: admins are told a new offer is waiting on them.
        notifyShiftOffer(ss, "SUBMITTED", savedOffer, authOffer.userId);
        logSystemEvent(ss, authOffer.userId, "SUBMIT_SHIFT_OFFER", "Offered to fill " + describeShiftOffer(savedOffer));

        responseData = { success: true, offer: savedOffer };
        break;
      }

      case "CLOCK_IN": {
        // Accept fields from top-level request body or nested payload
        const clockInUserId = data.user_id || payload.user_id;
        const clockInAuth = getAuthContext(ss, data);
        if (!clockInAuth) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        if (String(clockInAuth.userId) !== String(clockInUserId)) {
          responseData = { success: false, message: "You can only clock in for yourself." };
          break;
        }
        // Enforced here as well as in the UI: a role without the timeclock
        // permission sees the station clock but no Clock In button, and this is
        // what stops the call being made anyway.
        if (!hasRolePermission(ss, clockInAuth.userId, "can_use_timeclock")) {
          responseData = { success: false, message: "Your role does not have access to the timeclock." };
          break;
        }
        const clockInGpsLat = data.gps_lat || payload.gps_lat || "";
        const clockInGpsLon = data.gps_lon || payload.gps_lon || "";
        const clockInIsManual = data.is_manual || payload.is_manual || false;

        // Optional station geofence. Checked before anything is written, so a rejected action
        // leaves the sheet untouched.
        const clockInLocationError = clockLocationRejection(ss, clockInGpsLat, clockInGpsLon);
        if (clockInLocationError) {
          responseData = { success: false, code: "OUT_OF_RANGE", message: clockInLocationError };
          break;
        }

        const timeclockSheetIn = ss.getSheetByName("timeclock");
        const timeInStamp = getEasternTimestamp();

        // A member with an open entry cannot open a second one. The UI disables the button, but two tabs - or a
        // tap on a slow connection - are not coordinated by the UI, and a double entry needs an administrator to
        // spot and delete it. Checked here as well as after the geofence, so a rejected action writes nothing.
        if (findOpenClockRow(timeclockSheetIn, clockInUserId)) {
          responseData = {
            success: false,
            code: "ALREADY_CLOCKED_IN",
            message: "You are already clocked in. Clock out first."
          };
          break;
        }

        const nextInId = String(newRowId());

        // Built through the sheet's OWN headers rather than as a positional array: every other sheet in this app
        // is written that way, and a positional append quietly misfiles a clock-in the first time somebody
        // reorders a column (see rowValuesForHeaders).
        //
        // Trailing blanks are trimmed before the append. The row is mapped over EVERY header, so columns this
        // action has no value for come back as "" - and writing an explicit "" into a column the app does not
        // own (the clock-in `calc_address`, which the sheet fills itself) is a change in behaviour for no gain.
        // Trimming keeps the old write identical for today's layout while still being correct by name.
        const timeclockHeadersIn = timeclockSheetIn.getRange(1, 1, 1, Math.max(timeclockSheetIn.getLastColumn(), 1)).getValues()[0];
        const clockInRow = rowValuesForHeaders(timeclockHeadersIn, {
          id: nextInId,
          time_in: timeInStamp,
          time_out: "",
          user_id: clockInUserId,
          gps_lon: clockInGpsLon,
          gps_lat: clockInGpsLat,
          is_manual: clockInIsManual
        });
        while (clockInRow.length && clockInRow[clockInRow.length - 1] === "") clockInRow.pop();
        timeclockSheetIn.appendRow(clockInRow);

        responseData = { success: true, id: nextInId, time_in: timeInStamp };

        logSystemEvent(
          ss, 
          clockInUserId, 
          "CLOCK_IN", 
          "User clocked in successfully."
        );
        break;
      }

      case "CLOCK_OUT": {
        // Accept fields from top-level request body or nested payload
        const clockOutUserId = data.user_id || payload.user_id;
        const clockOutAuth = getAuthContext(ss, data);
        if (!clockOutAuth) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        if (String(clockOutAuth.userId) !== String(clockOutUserId)) {
          responseData = { success: false, message: "You can only clock out for yourself." };
          break;
        }
        if (!hasRolePermission(ss, clockOutAuth.userId, "can_use_timeclock")) {
          responseData = { success: false, message: "Your role does not have access to the timeclock." };
          break;
        }
        const clockOutGpsLat = data.gps_lat || payload.gps_lat || "";
        const clockOutGpsLon = data.gps_lon || payload.gps_lon || "";

        // Same geofence as clock-in: an out-of-range clock-out leaves the open entry untouched.
        const clockOutLocationError = clockLocationRejection(ss, clockOutGpsLat, clockOutGpsLon);
        if (clockOutLocationError) {
          responseData = { success: false, code: "OUT_OF_RANGE", message: clockOutLocationError };
          break;
        }

        const timeclockSheetOut = ss.getSheetByName("timeclock");
        const rows = timeclockSheetOut.getDataRange().getValues();
        const headers = rows[0];
        
        const timeOutCol = headers.indexOf("time_out");
        const gpsLonOutCol = headers.indexOf("gps_lon_out");
        const gpsLatOutCol = headers.indexOf("gps_lat_out");
        const calcAddressOutCol = headers.indexOf("calc_address_out");

        const timeOutStamp = getEasternTimestamp();
        // The open entry, found by the same helper clock-in uses to refuse a second one, so "which row is open"
        // has one definition rather than two loops that can drift apart.
        const openRow = findOpenClockRow(timeclockSheetOut, clockOutUserId, rows);

        if (openRow) {
          // The address is looked up BEFORE anything is written, and the whole row goes in with ONE call.
          //
          // This used to be up to four separate setValue calls with the reverse geocode between them, which had
          // two costs: a failure inside that network call left the row stamped out with no address, and the
          // script lock stayed held for the length of a Google Maps round trip - so every other writer waited
          // behind a lookup that has nothing to do with the sheet.
          const outAddress = (calcAddressOutCol !== -1 && clockOutGpsLat && clockOutGpsLon)
            ? GOOGLEMAPS_REVERSEGEOCODE(clockOutGpsLat, clockOutGpsLon)
            : "";

          const updatedRow = rows[openRow.sheetRow - 1].slice();
          while (updatedRow.length < headers.length) updatedRow.push("");
          updatedRow[timeOutCol] = timeOutStamp;
          if (gpsLonOutCol !== -1 && clockOutGpsLon) updatedRow[gpsLonOutCol] = clockOutGpsLon;
          if (gpsLatOutCol !== -1 && clockOutGpsLat) updatedRow[gpsLatOutCol] = clockOutGpsLat;
          if (calcAddressOutCol !== -1 && outAddress) updatedRow[calcAddressOutCol] = outAddress;

          timeclockSheetOut.getRange(openRow.sheetRow, 1, 1, updatedRow.length).setValues([updatedRow]);

          responseData = { success: true, time_out: timeOutStamp };

          logSystemEvent(
            ss, 
            clockOutUserId, 
            "CLOCK_OUT", 
            "User clocked out via GPS: " + (clockOutGpsLat && clockOutGpsLon ? clockOutGpsLat + ", " + clockOutGpsLon : "No GPS data")
          );
        } else {
          responseData = { success: false, message: "No active shift found to clock out." };

          logSystemEvent(
            ss, 
            clockOutUserId, 
            "CLOCK_OUT_FAILED", 
            "Attempted clock out without active shift."
          );
        }
        break;
      }

      case "UPDATE_USER_SETTINGS": {
        const authSettings = getAuthContext(ss, data);
        if (!authSettings) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }

        // Identity always comes from the session, never the request body.
        const targetUserId = String(authSettings.userId);
        const settingsValues = {};

        if (payload.time_format !== undefined && payload.time_format !== null && String(payload.time_format) !== "") {
          settingsValues.time_format = String(payload.time_format);
        }
        if (payload.is_dark_mode !== undefined && payload.is_dark_mode !== null && String(payload.is_dark_mode) !== "") {
          settingsValues.is_dark_mode = String(payload.is_dark_mode);
        }

        // Notification opt-ins. Unlike time_format, an empty string is
        // meaningful here: it means "inherit the station default".
        //
        // This list must cover every key in src/utils/notificationPrefs.js — a key missing here is
        // silently rejected, which reads as a failed save for the member. verify:notification-prefs
        // asserts the two lists agree, because there is no way to share them (the backend cannot
        // import the client module).
        ["notify_new_offer", "notify_offer_approved", "notify_offer_declined", "notify_announcements"].forEach(function (key) {
          if (payload[key] !== undefined && payload[key] !== null) {
            settingsValues[key] = String(payload[key]).trim();
          }
        });
        if (payload.fcm_token !== undefined && payload.fcm_token !== null) {
          settingsValues.fcm_token = String(payload.fcm_token).trim();
        }

        // Deliberately NOT accepted here: runner_sound_profile. It is an administrator-managed
        // attribute and lives on the users sheet, so a member cannot choose their own sound set by
        // posting one. This whitelist is the whole guard, which is why the keys are listed
        // explicitly rather than copied across from the payload.

        if (!Object.keys(settingsValues).length) {
          responseData = { success: false, message: "No settings were supplied." };
          break;
        }

        // Only the supplied columns are touched, so registering a device
        // (fcm_token alone) can't disturb the rest of the row.
        const settingsSaved = upsertUserSettingsColumns(ss, targetUserId, settingsValues);
        responseData = settingsSaved
          ? {
              success: true,
              message: "Settings updated successfully",
              updatedSetting: Object.assign({ id: targetUserId }, settingsValues)
            }
          : { success: false, message: "Could not locate your user_settings row." };
        break;
      }

      // Push registration is per DEVICE: a member's phone and computer each register their own
      // token, so enabling one cannot take delivery away from the other. Identity comes from the
      // session, so a member can only ever register a device against themselves.
      case "REGISTER_PUSH_DEVICE": {
        const authDevice = getAuthContext(ss, data);
        if (!authDevice) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }

        // The device token travels as `device_token`, NOT `token`: `token` is the session in the RPC
        // envelope, and reading it here would register the session as a push device. (The same
        // collision produced a broken System Log request earlier, so the name is deliberate.)
        const deviceToken = String(data.device_token || payload.device_token || "").trim();
        const deviceLabel = String(data.device_label || payload.device_label || "").trim();

        if (!deviceToken) {
          responseData = { success: false, message: "No device token was supplied." };
          break;
        }

        const registered = registerPushDevice(ss, authDevice.userId, deviceToken, deviceLabel);
        responseData = registered
          ? { success: true, devices: pushTokensForUser(ss, authDevice.userId).length }
          : { success: false, message: "Could not register this device." };
        break;
      }

      // Removes ONE device. Deliberately token-scoped: turning notifications off on a phone must
      // leave the member's computer registered, which is the bug this pair of actions exists to fix.
      case "UNREGISTER_PUSH_DEVICE": {
        const authUnregister = getAuthContext(ss, data);
        if (!authUnregister) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }

        // `device_token`, not `token` - see the note on REGISTER_PUSH_DEVICE above.
        const removeToken = String(data.device_token || payload.device_token || "").trim();
        if (!removeToken) {
          responseData = { success: false, message: "No device token was supplied." };
          break;
        }

        responseData = { success: true, removed: deletePushTokens(ss, [removeToken], authUnregister.userId) };
        break;
      }

      // The signed-in member's own devices, WITHOUT tokens.
      //
      // A label and a last-seen stamp are what the settings card needs to say "also on 2 other
      // devices", and a token is a credential-shaped value that has no business travelling to a
      // browser that does not already hold it.
      case "MY_PUSH_DEVICES": {
        const authMyDevices = getAuthContext(ss, data);
        if (!authMyDevices) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }

        const myDeviceUserId = String(authMyDevices.userId).trim();
        responseData = {
          success: true,
          devices: pushDeviceRows(ss).filter(function (row) {
            return String(row.user_id || "").trim() === myDeviceUserId;
          }).map(function (row) {
            return {
              id: String(row.id === undefined || row.id === null ? "" : row.id),
              device_label: String(row.device_label || "").trim(),
              updated_at: String(row.updated_at || "").trim()
            };
          })
        };
        break;
      }

      case "UPDATE_USER_PASSWORD": {
        const authPassword = getAuthContext(ss, data);
        if (!authPassword) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        // Re-authentication is done via the calling session; users can only
        // change their own password.
        const currentSessionToken = String(data.token || (payload && payload.token) || "");
        const targetPasswordUserId = authPassword.userId;
        const newUserPassword = data.password || payload.password;

        const usersSheet = ss.getSheetByName("users");
        const userRows = usersSheet.getDataRange().getValues();
        const userHeaders = userRows[0];
        
        const userIdIdx = userHeaders.indexOf("id");
        const passIdx = userHeaders.indexOf("password");
        
        let targetUserRow = -1;

        for (let i = 1; i < userRows.length; i++) {
          if (userRows[i][userIdIdx] == targetPasswordUserId) {
            targetUserRow = i + 1;
            break;
          }
        }

        // Guard against clearing the column. A blank password can never sign in
        // (see verifyPasswordValue), so writing one would lock the member out.
        if (String(newUserPassword == null ? "" : newUserPassword).length === 0) {
          responseData = { success: false, message: "Password cannot be empty." };
          break;
        }

        if (targetUserRow !== -1) {
          // Stored as a PBKDF2 hash - see the password hashing section.
          usersSheet.getRange(targetUserRow, passIdx + 1).setValue(hashPasswordValue(newUserPassword));
          responseData = { success: true };

          // Invalidate all other sessions so a compromised/old token can't be reused
          revokeSessionsForUser(authPassword.userId, currentSessionToken);

          // System Log
          logSystemEvent(
            ss, 
            targetPasswordUserId, 
            "PASSWORD_CHANGE", 
            "User successfully updated their account password."
          );
        } else {
          responseData = { success: false, message: "User not found." };
        }
        break;
      }

      case "ADMIN_GET_USERS": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_users")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        // Fetch users but strip passwords before returning to client
        const rawUsersAdmin = getSheetData(ss, "users");
        const safeUsersAdmin = rawUsersAdmin.map(function(u) {
          var userCopy = Object.assign({}, u);
          delete userCopy.password; // Do not leak passwords!
          return userCopy;
        });

        // runner_sound_profile travels with the row already: it lives on the users sheet with the
        // other administrator-managed attributes, so there is nothing to merge in here.

        responseData = { success: true, users: safeUsersAdmin };
        break;
      }

      case "ADMIN_SAVE_USER": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_users")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const usersSheetAdmin = ss.getSheetByName("users");
        const userFields = {
          id: String(data.id || payload.id || ""),
          user_name: data.user_name || payload.user_name || "",
          name: data.name || payload.name || "",
          status: data.status || payload.status || "",
          role_id: String(data.role_id || payload.role_id || ""),
          rank_id: String(data.rank_id || payload.rank_id || "")
        };
        // Optional scheduling-exclusion flag. Normalized to TRUE/FALSE text and
        // only written when supplied so older clients can't clobber the value.
        const rawExclude = data.exclude_from_scheduling !== undefined
          ? data.exclude_from_scheduling
          : payload.exclude_from_scheduling;
        if (rawExclude !== undefined) {
          const excludeText = String(rawExclude).trim().toUpperCase();
          userFields.exclude_from_scheduling = excludeText === "TRUE" ? "TRUE" : "FALSE";
        }
        // Only overwrite the password if a new one was supplied, and always store
        // it as a PBKDF2 hash so no code path can write a plain-text password.
        const newPasswordAdmin = data.password || payload.password;
        if (newPasswordAdmin) userFields.password = hashPasswordValue(newPasswordAdmin);

        // The Firefighter Runner sound profile. It lives on the users sheet with the other
        // administrator-managed per-member attributes (status, role, rank, scheduling), and it is
        // guarded by is_admin rather than the can_edit_users this action already required - a
        // cosmetic station setting, not part of running the roster.
        //
        // Ignored for anyone else rather than refused: the form disables the field for them, so a
        // request carrying it is either an old client or a hand-rolled one, and refusing would
        // break saving the rest of the user.
        const rawSoundProfile = data.runner_sound_profile !== undefined
          ? data.runner_sound_profile
          : payload.runner_sound_profile;
        if (rawSoundProfile !== undefined && isAdminUser(ss, authCtx.userId)) {
          const soundProfile = normalizeRunnerSoundProfile(rawSoundProfile);
          if (!runnerSoundProfileIsValid(soundProfile)) {
            responseData = {
              success: false,
              message: "A sound profile can only contain letters, numbers, dashes and underscores."
            };
            break;
          }
          // upsertSheetRowById writes by header name and does NOT grow the header row, so a
          // missing column would silently swallow the value. Say so instead.
          const userHeaders = usersSheetAdmin.getDataRange().getValues()[0] || [];
          if (userHeaders.indexOf("runner_sound_profile") === -1) {
            responseData = {
              success: false,
              message: "The users sheet has no runner_sound_profile column. Add one and save again."
            };
            break;
          }
          userFields.runner_sound_profile = soundProfile;
        }

        const savedUserId = upsertSheetRowById(usersSheetAdmin, userFields);
        responseData = { success: true, id: savedUserId };

        logSystemEvent(ss, authCtx.userId, "ADMIN_SAVE_USER", "Admin saved user " + savedUserId);
        break;
      }

      case "ADMIN_DELETE_USER": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_users")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const targetDeleteUserId = data.id || payload.id;
        const deletedUser = deleteSheetRowById(ss.getSheetByName("users"), targetDeleteUserId);
        responseData = { success: deletedUser, message: deletedUser ? "User deleted." : "User not found." };

        if (deletedUser) {
          logSystemEvent(ss, authCtx.userId, "ADMIN_DELETE_USER", "Admin deleted user " + targetDeleteUserId);
        }
        break;
      }

      case "ADMIN_SAVE_ROLE": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_roles")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const rolesSheet = ss.getSheetByName("roles");
        const targetRoleId = String(data.id || payload.id || "");
        const actorIsAdmin = isAdminUser(ss, authCtx.userId);

        // An existing role is what is being replaced, so its CURRENT flags decide
        // who may touch it: a role carrying Administrator access can only be
        // changed by an administrator, whatever the editor's own role allows.
        const existingRole = targetRoleId
          ? getSheetData(ss, "roles").find(function (r) { return String(r.id) === targetRoleId; })
          : null;
        if (existingRole && roleFlagValue(existingRole, "is_admin") && !actorIsAdmin) {
          responseData = {
            success: false,
            message: "Only an administrator can change a role that has Administrator access."
          };
          break;
        }

        // A non-administrator may not GRANT administrator access either - otherwise
        // a role with "Manage roles" could lift itself to full access, which would
        // make every other permission moot.
        const requestedIsAdmin = isTruthyValue(
          data.is_admin !== undefined ? data.is_admin : payload.is_admin
        );
        if (requestedIsAdmin && !actorIsAdmin) {
          responseData = {
            success: false,
            message: "Only an administrator can grant Administrator access."
          };
          break;
        }

        const roleFields = {
          id: targetRoleId,
          description: data.description !== undefined ? data.description : payload.description,
          is_admin: requestedIsAdmin
        };

        // Every permission column is copied through by NAME (they all share the
        // `can_` prefix), so this handler does not carry a second copy of the
        // permission list - adding a column to the roles sheet is enough. Columns
        // the sheet does not have are ignored by upsertSheetRowById.
        Object.keys(data).concat(Object.keys(payload || {})).forEach(function (field) {
          if (field.indexOf("can_") !== 0) return;
          const raw = data[field] !== undefined ? data[field] : payload[field];
          if (raw === undefined) return;
          roleFields[field] = isTruthyValue(raw);
        });

        const savedRoleId = upsertSheetRowById(rolesSheet, roleFields);
        responseData = { success: true, id: savedRoleId };

        logSystemEvent(ss, authCtx.userId, "ADMIN_SAVE_ROLE", "Admin saved role " + savedRoleId);
        break;
      }

      case "ADMIN_DELETE_ROLE": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_roles")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const targetDeleteRoleId = data.id || payload.id;

        // Same protection as saving: an administrator-only role is out of reach
        // for a role that merely manages roles.
        const roleToDelete = getSheetData(ss, "roles").find(function (r) {
          return String(r.id) === String(targetDeleteRoleId);
        });
        if (roleToDelete && roleFlagValue(roleToDelete, "is_admin") && !isAdminUser(ss, authCtx.userId)) {
          responseData = {
            success: false,
            message: "Only an administrator can delete a role that has Administrator access."
          };
          break;
        }

        const deletedRole = deleteSheetRowById(ss.getSheetByName("roles"), targetDeleteRoleId);
        responseData = { success: deletedRole, message: deletedRole ? "Role deleted." : "Role not found." };

        if (deletedRole) {
          logSystemEvent(ss, authCtx.userId, "ADMIN_DELETE_ROLE", "Admin deleted role " + targetDeleteRoleId);
        }
        break;
      }

      case "ADMIN_SAVE_RANK": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_ranks")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const rankFields = {
          id: String(data.id || payload.id || ""),
          description: data.description || payload.description || "",
          color: data.color || payload.color || "",
          icon: data.icon || payload.icon || ""
        };

        // Rank seniority: higher number = higher rank. A member can fill shifts
        // for their own rank and every lower one. Only written when supplied.
        const rawRankOrder = data.rank_order !== undefined
          ? data.rank_order
          : payload.rank_order;
        if (rawRankOrder !== undefined) {
          const trimmedRankOrder = String(rawRankOrder).trim();
          const parsedRankOrder = parseInt(trimmedRankOrder, 10);
          rankFields.rank_order = trimmedRankOrder === ""
            ? ""
            : (Number.isFinite(parsedRankOrder) ? parsedRankOrder : trimmedRankOrder);
        }

        const savedRankId = upsertSheetRowById(ss.getSheetByName("ranks"), rankFields);
        responseData = { success: true, id: savedRankId };

        logSystemEvent(ss, authCtx.userId, "ADMIN_SAVE_RANK", "Admin saved rank " + savedRankId);
        break;
      }

      case "ADMIN_DELETE_RANK": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_ranks")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const targetDeleteRankId = data.id || payload.id;
        const deletedRank = deleteSheetRowById(ss.getSheetByName("ranks"), targetDeleteRankId);
        responseData = { success: deletedRank, message: deletedRank ? "Rank deleted." : "Rank not found." };

        if (deletedRank) {
          logSystemEvent(ss, authCtx.userId, "ADMIN_DELETE_RANK", "Admin deleted rank " + targetDeleteRankId);
        }
        break;
      }

      case "ADMIN_SAVE_SHIFT": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_schedule_templates")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const shiftFields = {
          id: String(data.id || payload.id || ""),
          description: data.description || payload.description || "",
          start_time: data.start_time || payload.start_time || "",
          end_time: data.end_time || payload.end_time || "",
          is_monday: !!(data.is_monday !== undefined ? data.is_monday : payload.is_monday),
          is_tuesday: !!(data.is_tuesday !== undefined ? data.is_tuesday : payload.is_tuesday),
          is_wednesday: !!(data.is_wednesday !== undefined ? data.is_wednesday : payload.is_wednesday),
          is_thursday: !!(data.is_thursday !== undefined ? data.is_thursday : payload.is_thursday),
          is_friday: !!(data.is_friday !== undefined ? data.is_friday : payload.is_friday),
          is_saturday: !!(data.is_saturday !== undefined ? data.is_saturday : payload.is_saturday),
          is_sunday: !!(data.is_sunday !== undefined ? data.is_sunday : payload.is_sunday)
        };

        const savedShiftId = upsertSheetRowById(ss.getSheetByName("shifts"), shiftFields);
        responseData = { success: true, id: savedShiftId };

        logSystemEvent(ss, authCtx.userId, "ADMIN_SAVE_SHIFT", "Admin saved shift " + savedShiftId);
        break;
      }

      case "ADMIN_DELETE_SHIFT": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_schedule_templates")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const targetDeleteShiftId = data.id || payload.id;
        const deletedShift = deleteSheetRowById(ss.getSheetByName("shifts"), targetDeleteShiftId);
        responseData = { success: deletedShift, message: deletedShift ? "Shift deleted." : "Shift not found." };

        if (deletedShift) {
          logSystemEvent(ss, authCtx.userId, "ADMIN_DELETE_SHIFT", "Admin deleted shift " + targetDeleteShiftId);
        }
        break;
      }

      case "ADMIN_GET_SCHEDULE_TEMPLATES": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasAnyRolePermission(ss, authCtx.userId, ["can_edit_schedule_templates", "can_edit_assignments", "can_edit_schedule"])) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        // Reference data (assignments, apparatus) rides along so the admin tab
        // can render labels and pickers from a single request.
        responseData = {
          success: true,
          scheduleTemplates: getSheetData(ss, "schedule_templates"),
          assignments: getSheetData(ss, "assignments"),
          apparatus: getSheetData(ss, "apparatus")
        };
        break;
      }

      case "ADMIN_SAVE_SCHEDULE_TEMPLATE": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_schedule_templates")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const templateFields = {
          id: String(data.id || payload.id || ""),
          day_of_week: String(data.day_of_week || payload.day_of_week || "").trim().toLowerCase(),
          start_time: data.start_time || payload.start_time || "",
          end_time: data.end_time || payload.end_time || "",
          assignment_id: String(data.assignment_id || payload.assignment_id || ""),
          // Optional display name shown on the schedules in place of the times. Blank
          // clears it, which returns the shift to showing its window.
          nickname: String(data.nickname || payload.nickname || "").trim(),
          // Optional window. Blank means open-ended, which is how every existing template
          // behaves, so an empty cell is "no restriction" rather than "retired".
          // toDateKeyValue normalizes both a typed date and a real date cell to yyyy-MM-dd,
          // which is the form the client's comparison expects.
          effective_date: toDateKeyValue(data.effective_date !== undefined ? data.effective_date : payload.effective_date),
          end_date: toDateKeyValue(data.end_date !== undefined ? data.end_date : payload.end_date),
          // Optional apparatus link; not surfaced in the UI yet but preserved
          // through saves so existing values are never clobbered.
          apparatus_id: String(data.apparatus_id || payload.apparatus_id || "")
        };

        if (!templateFields.day_of_week || !templateFields.assignment_id) {
          responseData = { success: false, message: "Day of week and assignment are required." };
          break;
        }

        // An inverted window would retire the template before it started, so it is refused
        // rather than saved and puzzled over later.
        if (templateFields.effective_date && templateFields.end_date &&
            templateFields.effective_date > templateFields.end_date) {
          responseData = { success: false, message: "The end date must not be before the effective date." };
          break;
        }

        // The effective date is required for NEW and EDITED templates, so a pattern always says when it
        // started. Existing rows with a blank cell keep working, since a blank is read as "no
        // restriction" - enforcing that on read would remove every pre-existing template at once.
        if (!templateFields.effective_date) {
          responseData = { success: false, message: "An effective date is required." };
          break;
        }

        const savedTemplateId = upsertSheetRowById(ss.getSheetByName("schedule_templates"), templateFields);
        responseData = { success: true, id: savedTemplateId };

        logSystemEvent(ss, authCtx.userId, "ADMIN_SAVE_SCHEDULE_TEMPLATE", "Admin saved schedule template " + savedTemplateId);
        break;
      }

      case "ADMIN_DELETE_SCHEDULE_TEMPLATE": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_schedule_templates")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const targetTemplateId = data.id || payload.id;
        const deletedTemplate = deleteSheetRowById(ss.getSheetByName("schedule_templates"), targetTemplateId);
        responseData = { success: deletedTemplate, message: deletedTemplate ? "Schedule template deleted." : "Schedule template not found." };

        if (deletedTemplate) {
          logSystemEvent(ss, authCtx.userId, "ADMIN_DELETE_SCHEDULE_TEMPLATE", "Admin deleted schedule template " + targetTemplateId);
        }
        break;
      }

      case "ADMIN_SAVE_ASSIGNMENT": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_assignments")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const assignmentFields = {
          id: String(data.id || payload.id || ""),
          description: String(data.description || payload.description || "").trim()
        };

        // Minimum rank ORDER that may be scheduled into this assignment (the
        // `rank_order_required` column). Only written when supplied so older
        // clients can't blank out an existing value.
        const rawRankRequired = data.rank_order_required !== undefined
          ? data.rank_order_required
          : payload.rank_order_required;
        if (rawRankRequired !== undefined) {
          const trimmedRankRequired = String(rawRankRequired).trim();
          const parsedRankRequired = parseInt(trimmedRankRequired, 10);
          assignmentFields.rank_order_required = trimmedRankRequired === ""
            ? ""
            : (Number.isFinite(parsedRankRequired) ? parsedRankRequired : trimmedRankRequired);
        }

        // Optional colour (the `color` column) used to render this assignment
        // everywhere it appears. Only written when supplied, so an older client
        // can't blank an existing colour; an empty string explicitly clears it and
        // hands the assignment back to the automatic derived colour.
        const rawColor = data.color !== undefined ? data.color : payload.color;
        if (rawColor !== undefined) {
          const normalizedColor = normalizeHexColor(rawColor);
          if (normalizedColor === null) {
            responseData = { success: false, message: "Colour must be a hex value like #ef4444." };
            break;
          }
          assignmentFields.color = normalizedColor;
        }

        // Optional icon (the `icon` column) drawn with this assignment wherever it
        // appears, chosen from the same curated lucide set the ranks sheet uses.
        //
        // Stored as the icon's NAME and not validated here on purpose: the catalogue
        // lives in the client (src/components/RankIcon.jsx), exactly like the permission
        // list, so the server just keeps whatever it is given. An unrecognised name
        // renders the fallback icon rather than breaking the row.
        const rawIcon = data.icon !== undefined ? data.icon : payload.icon;
        if (rawIcon !== undefined) {
          assignmentFields.icon = String(rawIcon).trim();
        }

        // Optional window (the `effective_date` / `end_date` columns), so an assignment can be
        // started or retired on a date instead of being deleted. Blank means open-ended, which is
        // how every existing assignment behaves, so an empty cell is "no restriction" rather than
        // "retired". Normalized to yyyy-MM-dd, the form the client's comparison expects.
        const rawEffective = data.effective_date !== undefined ? data.effective_date : payload.effective_date;
        const rawEnd = data.end_date !== undefined ? data.end_date : payload.end_date;
        if (rawEffective !== undefined) assignmentFields.effective_date = toDateKeyValue(rawEffective);
        if (rawEnd !== undefined) assignmentFields.end_date = toDateKeyValue(rawEnd);

        // An inverted window would retire the assignment before it started, so it is refused rather
        // than saved and puzzled over later. Checked only when both arrive, since a partial update
        // (one date supplied) cannot invert anything on its own.
        if (assignmentFields.effective_date && assignmentFields.end_date &&
            assignmentFields.effective_date > assignmentFields.end_date) {
          responseData = { success: false, message: "The end date must not be before the effective date." };
          break;
        }

        // The effective date is required for NEW and EDITED assignments. An assignment created before
        // the rule, with a blank cell, keeps working: a blank reads as "no restriction", so enforcing
        // that on read would retire every pre-existing assignment at once.
        //
        // Only checked when the client actually supplied the field, so a partial update that touches
        // other columns cannot be rejected for a date it never mentioned.
        if (rawEffective !== undefined && !assignmentFields.effective_date) {
          responseData = { success: false, message: "An effective date is required." };
          break;
        }

        if (!assignmentFields.description) {
          responseData = { success: false, message: "Description is required." };
          break;
        }

        const savedAssignmentId = upsertSheetRowById(ss.getSheetByName("assignments"), assignmentFields);
        responseData = { success: true, id: savedAssignmentId };

        logSystemEvent(ss, authCtx.userId, "ADMIN_SAVE_ASSIGNMENT", "Admin saved assignment " + savedAssignmentId);
        break;
      }

      case "ADMIN_DELETE_ASSIGNMENT": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_assignments")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const targetAssignmentId = data.id || payload.id;
        const deletedAssignment = deleteSheetRowById(ss.getSheetByName("assignments"), targetAssignmentId);
        responseData = { success: deletedAssignment, message: deletedAssignment ? "Assignment deleted." : "Assignment not found." };

        if (deletedAssignment) {
          logSystemEvent(ss, authCtx.userId, "ADMIN_DELETE_ASSIGNMENT", "Admin deleted assignment " + targetAssignmentId);
        }
        break;
      }

      case "ADMIN_BULK_SAVE_SCHEDULE": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_schedule")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        // One request flushes everything the Schedule Management tab held in
        // memory: entries are upserted by id (blank id = new row) and the ids
        // in deleteIds are removed.
        // One read + batched writes instead of a full sheet read per entry,
        // which keeps even large monthly saves fast.
        const scheduleSheet = ss.getSheetByName("schedule");
        const entries = Array.isArray(data.entries) ? data.entries : [];
        const deleteIds = Array.isArray(data.deleteIds) ? data.deleteIds : [];

        // Custom shifts (entries with no schedule template) store their window
        // in start_time/end_time columns on the schedule sheet. Those columns
        // must exist before such an entry can be saved, otherwise its times
        // would be silently dropped.
        const scheduleHeaders = scheduleSheet.getDataRange().getValues()[0] || [];
        const hasStartTimeCol = scheduleHeaders.indexOf("start_time") !== -1;
        const hasEndTimeCol = scheduleHeaders.indexOf("end_time") !== -1;
        const needsTimeCols = entries.some(function (raw) {
          raw = raw || {};
          return String(raw.start_time || "") !== "" || String(raw.end_time || "") !== "";
        });
        if (needsTimeCols && (!hasStartTimeCol || !hasEndTimeCol)) {
          responseData = {
            success: false,
            message: "The schedule sheet is missing the start_time and/or end_time columns needed to save custom shifts. Add them to the sheet and try again."
          };
          break;
        }

        // Filter invalid entries, remembering each one's original position so
        // the returned ids stay aligned with the request's entry order.
        const validEntries = [];
        const validIndex = [];
        for (let i = 0; i < entries.length; i++) {
          const fields = normalizeScheduleEntry(entries[i], hasStartTimeCol && hasEndTimeCol);
          if (!fields) continue; // no date - nothing to store
          validEntries.push(fields);
          validIndex.push(i);
        }

        const assignedIds = bulkUpsertSheetRowsById(scheduleSheet, validEntries);
        const ids = new Array(entries.length).fill("");
        for (let j = 0; j < validIndex.length; j++) {
          ids[validIndex[j]] = assignedIds[j];
        }

        const deletedCount = bulkDeleteSheetRowsById(scheduleSheet, deleteIds);

        responseData = { success: true, saved: assignedIds.length, deleted: deletedCount, ids: ids };
        logSystemEvent(ss, authCtx.userId, "ADMIN_BULK_SAVE_SCHEDULE", "Saved " + assignedIds.length + " schedule entries, deleted " + deletedCount);
        break;
      }

      case "ADMIN_GET_SCHEDULE_OFFERS": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasAnyRolePermission(ss, authCtx.userId, ["can_approve_shifts", "can_edit_schedule"])) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        // Sent with `status` (pending/approved/declined), a normalized date key
        // and the slot key the calendar matches pills against.
        responseData = { success: true, offers: getSheetData(ss, "schedule_offers").map(normalizeOffer) };
        break;
      }

      case "ADMIN_RESOLVE_SHIFT_OFFER": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_approve_shifts")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const resolveId = String(data.id || payload.id || "").trim();
        const decision = String(data.decision || payload.decision || "").trim().toUpperCase();
        if (!resolveId || (decision !== "APPROVE" && decision !== "DECLINE")) {
          responseData = { success: false, message: "An offer id and an APPROVE or DECLINE decision are required." };
          break;
        }

        const offerSheet = ss.getSheetByName("schedule_offers");
        const resolveOffer = offerSheet ? findRowById(getSheetData(ss, "schedule_offers"), resolveId) : null;
        if (!resolveOffer) {
          responseData = { success: false, message: "That offer no longer exists." };
          break;
        }
        if (offerStatus(resolveOffer) !== "pending") {
          responseData = { success: false, message: "That offer was already " + offerStatus(resolveOffer) + "." };
          break;
        }

        if (decision === "DECLINE") {
          upsertSheetRowById(offerSheet, { id: resolveId, declined_by: authCtx.userId });

          const declinedOffer = normalizeOffer(findRowById(getSheetData(ss, "schedule_offers"), resolveId));
          notifyShiftOffer(ss, "DECLINED", declinedOffer, authCtx.userId);
          logSystemEvent(ss, authCtx.userId, "ADMIN_DECLINE_SHIFT_OFFER", "Declined offer " + resolveId + " for " + describeShiftOffer(declinedOffer));

          responseData = { success: true, decision: "DECLINED", offer: declinedOffer, declinedIds: [] };
          break;
        }

        // ---- Approve: fill the shift first, then close out its other offers.
        const fill = fillShiftFromOffer(ss, resolveOffer, authCtx.userId);
        if (!fill.ok) {
          responseData = { success: false, message: fill.message };
          break;
        }

        upsertSheetRowById(offerSheet, { id: resolveId, schedule_id: fill.scheduleId, approved_by: authCtx.userId });

        // The shift is now filled, so any other member still waiting on it is
        // closed out (stamped as declined by the approving admin) instead of
        // dangling as pending forever.
        const siblings = getSheetData(ss, "schedule_offers").filter(function (o) {
          return String(o.id) !== resolveId && offerStatus(o) === "pending" && slotKeyOfOffer(o) === slotKeyOfOffer(resolveOffer);
        });
        for (let i = 0; i < siblings.length; i++) {
          upsertSheetRowById(offerSheet, { id: String(siblings[i].id), declined_by: authCtx.userId });
        }

        const approvedOffer = normalizeOffer(findRowById(getSheetData(ss, "schedule_offers"), resolveId));
        notifyShiftOffer(ss, "APPROVED", approvedOffer, authCtx.userId);
        logSystemEvent(
          ss,
          authCtx.userId,
          "ADMIN_APPROVE_SHIFT_OFFER",
          "Approved offer " + resolveId + " for " + describeShiftOffer(approvedOffer) + " (schedule row " + fill.scheduleId + ", closed " + siblings.length + " other offer(s))"
        );

        responseData = {
          success: true,
          decision: "APPROVED",
          offer: approvedOffer,
          scheduleId: fill.scheduleId,
          // Returned so the admin calendar can show the filled shift without a refetch.
          scheduleRow: findRowById(getSheetData(ss, "schedule"), fill.scheduleId),
          declinedIds: siblings.map(function (o) { return String(o.id); })
        };
        break;
      }

      case "ADMIN_SET_AVAILABILITY": {
        const authAvailAdmin = getAuthContext(ss, data);
        if (!authAvailAdmin || !hasRolePermission(ss, authAvailAdmin.userId, "can_edit_member_availability")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const targetUserId = String(data.user_id || payload.user_id || "");
        if (!targetUserId) {
          responseData = { success: false, message: "user_id is required." };
          break;
        }

        // The same batch as SET_MY_AVAILABILITY, applied to another member.
        const adminAvailResult = setAvailabilityRows(
          ss,
          targetUserId,
          data.adds || payload.adds,
          data.removes || payload.removes
        );
        if (!adminAvailResult.ok) {
          responseData = { success: false, message: adminAvailResult.message };
          break;
        }

        responseData = {
          success: true,
          added: adminAvailResult.added,
          cleared: adminAvailResult.cleared,
          skipped: adminAvailResult.skipped
        };
        logSystemEvent(ss, authAvailAdmin.userId, "ADMIN_SET_AVAILABILITY", "Admin saved availability for user " + targetUserId + ": +" + adminAvailResult.added + " -" + adminAvailResult.cleared + (adminAvailResult.skipped ? " (" + adminAvailResult.skipped + " skipped)" : ""));
        break;
      }

      case "ADMIN_SAVE_SYSTEM_SETTING": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const settingKey = data.key || payload.key;
        const settingValue = data.value !== undefined ? data.value : payload.value;

        if (!settingKey) {
          responseData = { success: false, message: "Setting key is required." };
          break;
        }

        // Notification settings are also editable by a role that manages
        // notifications but not the rest of the system - the Station defaults card
        // on that tab writes these keys. Such a role is held to the notify_* keys,
        // so the permission cannot be used to change unrelated system settings.
        const canEditAllSettings = hasRolePermission(ss, authCtx.userId, "can_edit_system_settings");
        const canEditNotificationsOnly =
          !canEditAllSettings &&
          hasRolePermission(ss, authCtx.userId, "can_edit_notification_settings");

        if (!canEditAllSettings && !canEditNotificationsOnly) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }
        if (canEditNotificationsOnly && String(settingKey).indexOf("notify_") !== 0) {
          responseData = {
            success: false,
            message: "Changing system settings requires the 'Manage system settings' permission."
          };
          break;
        }

        let sysSettingsSheet = ss.getSheetByName("system_settings");
        if (!sysSettingsSheet) {
          sysSettingsSheet = ss.insertSheet("system_settings");
          sysSettingsSheet.appendRow(["key", "value"]);
        }

        upsertKeyValueRow(sysSettingsSheet, "key", "value", settingKey, settingValue);
        responseData = { success: true, key: settingKey, value: settingValue };

        // The idle timeout is the one setting that lives in live sessions as well as the sheet, so
        // saving it has to push the new window out to them. This is what lets getAuthContext skip
        // looking the setting up on every request.
        if (String(settingKey) === "session_timeout") {
          responseData.sessionsRetuned = retuneSessions(ss);
        }

        logSystemEvent(ss, authCtx.userId, "ADMIN_SAVE_SYSTEM_SETTING", "Admin set " + settingKey + " = " + settingValue);
        break;
      }

      case "ADMIN_SAVE_SYSTEM_SETTINGS": {
        const authBatch = getAuthContext(ss, data);
        if (!authBatch) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        // The SAME permission split as the single-key action, applied to the whole batch before anything is
        // written: a notifications-only role stays confined to notify_* keys, and cannot smuggle an unrelated
        // key in beside the ones it may edit. All-or-nothing is deliberate - a partly applied batch is the
        // exact outcome this action exists to remove.
        const canEditAllBatch = hasRolePermission(ss, authBatch.userId, "can_edit_system_settings");
        const canEditNotifyBatch =
          !canEditAllBatch && hasRolePermission(ss, authBatch.userId, "can_edit_notification_settings");
        if (!canEditAllBatch && !canEditNotifyBatch) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const batchRefusal = settingBatchRefusal(data.settings || payload.settings, {
          canEditAll: canEditAllBatch,
          canEditNotificationsOnly: canEditNotifyBatch
        });
        if (batchRefusal) {
          responseData = { success: false, message: batchRefusal };
          break;
        }

        const batchPairs = settingPairsFrom(data.settings || payload.settings);
        const writtenKeys = setSystemSettingsBatch(ss, batchPairs);
        responseData = { success: true, keys: writtenKeys };

        // Only once, however many keys the batch carried - and only when one of them is the idle timeout,
        // which is the one setting that lives in live sessions as well as the sheet.
        if (writtenKeys.indexOf("session_timeout") !== -1) {
          responseData.sessionsRetuned = retuneSessions(ss);
        }
        logSystemEvent(
          ss,
          authBatch.userId,
          "ADMIN_SAVE_SYSTEM_SETTINGS",
          "Admin set " + writtenKeys.join(", ")
        );
        break;
      }

      case "ADMIN_DELETE_SYSTEM_SETTING": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_system_settings")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const targetSettingKey = data.key || payload.key;
        const sysSettingsSheetDel = ss.getSheetByName("system_settings");
        const deletedSetting = sysSettingsSheetDel ? deleteKeyValueRow(sysSettingsSheetDel, "key", targetSettingKey) : false;
        responseData = { success: deletedSetting, message: deletedSetting ? "Setting deleted." : "Setting not found." };

        if (deletedSetting) {
          logSystemEvent(ss, authCtx.userId, "ADMIN_DELETE_SYSTEM_SETTING", "Admin deleted setting " + targetSettingKey);
        }
        break;
      }

      case "ADMIN_GET_FCM_STATUS": {
        const authCtx = getAuthContext(ss, data);
        // Administrator-only: this reports on the FCM service-account credentials,
        // and the Notifications tab disables the credential card for everyone else.
        if (!authCtx || !isAdminUser(ss, authCtx.userId)) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        // Reports *whether* each credential is present, never its value. The
        // service-account private key is write-only: it is never sent back to
        // any client, not even an authenticated admin, so a compromised admin
        // session cannot exfiltrate the ability to push to every member.
        const fcmStatus = fcmConfig(ss);

        responseData = {
          success: true,
          project_id: fcmStatus.projectId,
          service_account_email: fcmStatus.clientEmail,
          credential_source: fcmStatus.credentialSource,
          has_private_key: !!fcmStatus.privateKey,
          has_web_config: !!String(fcmStatus.settings.fcm_web_config || "").trim(),
          has_vapid_key: !!String(fcmStatus.settings.fcm_vapid_public_key || "").trim(),
          ready: fcmStatus.ready
        };
        break;
      }

      case "ADMIN_GET_PUSH_STATUS": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_notification_settings")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const settingsIndex = userSettingsIndex(ss);
        const config = fcmConfig(ss);
        // Counted per DEVICE now, so an administrator can see who has a phone as well as a computer
        // - and so "no device" is distinguishable from "one device".
        const deviceCounts = pushDeviceCountByUser(ss);

        responseData = {
          success: true,
          fcm_ready: config.ready,
          // Blank opt-in cells mean "inherit the station default"; the admin
          // screen renders those as "Default".
          users: getSheetData(ss, "users").map(function (user) {
            const row = settingsIndex[String(user.id).trim()];
            const deviceCount = deviceCounts[String(user.id).trim()] || 0;
            return {
              id: String(user.id),
              name: user.name || user.user_name || String(user.id),
              device_registered: deviceCount > 0,
              device_count: deviceCount,
              notify_new_offer: row ? row.notify_new_offer : "",
              notify_offer_approved: row ? row.notify_offer_approved : "",
              notify_offer_declined: row ? row.notify_offer_declined : ""
            };
          })
        };
        break;
      }

      case "ADMIN_SEND_TEST_PUSH": {
        const authCtx = getAuthContext(ss, data);
        // Part of the FCM credential card, so administrator-only like the status
        // call above - it exercises the stored service account directly.
        if (!authCtx || !isAdminUser(ss, authCtx.userId)) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const targetUserId = String(data.user_id || payload.user_id || "").trim();
        const testConfig = fcmConfig(ss);

        if (!testConfig.ready) {
          responseData = { success: false, message: "Firebase Cloud Messaging is not configured yet." };
          break;
        }

        // Every device this member has registered, so a test actually proves delivery on each.
        const targetTokens = pushTokensForUser(ss, targetUserId);

        if (!targetTokens.length) {
          responseData = { success: false, message: "That member has no registered device." };
          break;
        }

        const testTitle = "Station Portal test";
        const testBody = "Test notification sent from the admin Notifications tab.";
        const deadTokens = [];
        let deliveredCount = 0;
        let lastFailure = null;

        targetTokens.forEach(function (token) {
          const testResult = sendFcmMessage(testConfig, token, testTitle, testBody, {
            event: "TEST",
            sent_by: String(authCtx.userId)
          });

          if (testResult.ok) {
            deliveredCount++;
            return;
          }

          lastFailure = testResult;
          const reason = testResult.reason || classifyFcmFailure(testResult.detail);

          // Only forget a token when FCM itself answered and said the token is dead. An
          // auth/config failure says nothing about the token.
          if (reason === "rejected" && (
            testResult.code === 404 ||
            /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/i.test(String(testResult.detail))
          )) {
            deadTokens.push(token);
          }
        });

        if (deadTokens.length) deletePushTokens(ss, deadTokens, targetUserId);

        if (deliveredCount) {
          logSystemEvent(
            ss,
            authCtx.userId,
            "ADMIN_SEND_TEST_PUSH",
            "Test push sent to user " + targetUserId + " (" + deliveredCount + " device(s))"
          );
          responseData = {
            success: true,
            devices: deliveredCount,
            message: deliveredCount === 1
              ? "Test notification sent to 1 device."
              : "Test notification sent to " + deliveredCount + " devices."
          };
          break;
        }

        const reason = lastFailure
          ? lastFailure.reason || classifyFcmFailure(lastFailure.detail)
          : "network";
        const detail = lastFailure ? String(lastFailure.detail) : "No device answered.";

        // Only a genuine FCM answer gets the "rejected" wording; anything else says what actually
        // went wrong and how to fix it.
        responseData = {
          success: false,
          reason: reason,
          message: reason === "rejected"
            ? "FCM rejected the test message" + (lastFailure && lastFailure.code ? " (" + lastFailure.code + ")" : "") + "."
            : "Could not send the test message.",
          advice: fcmFailureAdvice(reason),
          detail: detail.slice(0, 300)
        };
        break;
      }

      case "GET_TRAINING": {
        const authTraining = getAuthContext(ss, data);
        if (!authTraining) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }

        // The training list itself is not sensitive - it is the station's training record,
        // which attendees are expected to see - so any signed-in member may read it. What
        // differs by permission is the SIGNATURES: a member gets only their own, and the
        // full set only travels to someone who can administer trainings.
        const isTrainingAdmin = canAdministerTrainings(ss, authTraining.userId);

        responseData = {
          success: true,
          // Signature counts travel with the rows: the module needs to know whether anyone has
          // signed before it offers Edit, and a member cannot work that out from their own
          // signatures alone.
          trainings: trainingRowsForApp(ss),
          signatures: isTrainingAdmin
            ? normalizeSignatureRowsFor(ss, "", "")
            : trainingSignaturesForUser(ss, authTraining.userId),
          can_sign: canSignTrainings(ss, authTraining.userId),
          can_edit: hasRolePermission(ss, authTraining.userId, "can_edit_trainings"),
          can_administer: isTrainingAdmin
        };
        break;
      }

      case "SIGN_TRAINING": {
        // Members sign in bulk: the module collects a set of ticked trainings and saves once.
        //
        // Deliberately add-only. A signature is an acknowledgement of attendance, so this
        // action refuses removals outright rather than ignoring them - a silent no-op would
        // look like a working un-sign to a caller that expected one. Removal is
        // ADMIN_REMOVE_TRAINING_SIGNATURE, which requires can_administer_trainings.
        const authSign = getAuthContext(ss, data);
        if (!authSign) {
          responseData = { success: false, code: "UNAUTHORIZED", message: "Session expired. Please sign in again." };
          break;
        }
        if (!canSignTrainings(ss, authSign.userId)) {
          responseData = { success: false, message: "Your role does not have access to the training module." };
          break;
        }

        const requestedRemoveIds = payload.remove_training_ids || data.remove_training_ids || [];
        if (Array.isArray(requestedRemoveIds) && requestedRemoveIds.length > 0) {
          responseData = { success: false, message: "Signatures cannot be removed. Ask an administrator to correct a signature." };
          break;
        }

        const requestedSignIds = payload.training_ids || data.training_ids || [];
        const signSheet = ss.getSheetByName("training_signatures");
        if (!signSheet) {
          responseData = { success: false, message: "The training_signatures sheet is missing." };
          break;
        }

        // A closed training accepts no new signatures either - "locked" has to mean its
        // signatures as well as its fields, or the lock would only be half a lock.
        const closedTrainingRefusal = trainingWriteRefusal(ss, requestedSignIds);
        if (closedTrainingRefusal) {
          responseData = { success: false, message: closedTrainingRefusal };
          break;
        }

        // Only trainings that exist can be signed, so an id from a stale page cannot create a
        // signature pointing at nothing.
        const knownTrainingIds = getSheetData(ss, "training").map(function (row) {
          return String((row && row.id) || "").trim();
        });
        const existingSignatures = trainingSignaturesForUser(ss, authSign.userId);

        let signedCount = 0;
        let skippedCount = 0;
        (Array.isArray(requestedSignIds) ? requestedSignIds : []).forEach(function (rawId) {
          const trainingId = String(rawId || "").trim();
          if (!trainingId) return;
          if (knownTrainingIds.indexOf(trainingId) === -1) {
            skippedCount++;
            return;
          }
          // Already signed: nothing to do. Signing twice is not an error, it is a repeated
          // click, and the sheet must not gain a second row for the same member and training.
          const alreadySigned = existingSignatures.some(function (signature) {
            return signature.training_id === trainingId;
          });
          if (alreadySigned) return;

          upsertSheetRowById(signSheet, {
            id: "",
            training_id: trainingId,
            user_id: String(authSign.userId)
          });
          signedCount++;
        });

        responseData = {
          success: true,
          signed: signedCount,
          skipped: skippedCount,
          signatures: trainingSignaturesForUser(ss, authSign.userId)
        };
        if (signedCount > 0) {
          logSystemEvent(ss, authSign.userId, "SIGN_TRAINING", "Signed " + signedCount + " training(s)");
        }
        break;
      }

      case "SAVE_TRAINING": {
        // Adding and changing training details, for a role that manages trainings but does not
        // administer the report. Deletion is deliberately absent here: a training with
        // signatures attached is a record, so removing one is an administer-level action
        // (ADMIN_BULK_SAVE_TRAINING), not a side effect of editing.
        const authTrainingEdit = getAuthContext(ss, data);
        if (!authTrainingEdit || !hasRolePermission(ss, authTrainingEdit.userId, "can_edit_trainings")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const requestedTrainingDeleteIds = payload.deleteIds || data.deleteIds || [];
        if (Array.isArray(requestedTrainingDeleteIds) && requestedTrainingDeleteIds.length > 0) {
          responseData = { success: false, message: "Deleting a training requires the Training report permission." };
          break;
        }

        // A training anyone has signed is a record, not a draft: once it has a signature the
        // Training module stops letting it be changed, even for a role that manages trainings.
        // Corrections then belong in the Administration module, which is a deliberate step up.
        const editedTrainingIds = normalizeTrainingList(payload.trainings || data.trainings)
          .map(function (training) { return training.id; })
          .filter(function (id) { return id; });
        const signedTrainingIds = editedTrainingIds.filter(function (id) {
          return (trainingSignatureCounts(ss)[id] || 0) > 0;
        });
        if (signedTrainingIds.length) {
          responseData = {
            success: false,
            message: "Training " + signedTrainingIds.join(", ") +
              " has already been signed, so it can only be changed from the Administration Training report."
          };
          break;
        }

        const closedTrainingEditRefusal = trainingWriteRefusal(ss, editedTrainingIds);
        if (closedTrainingEditRefusal) {
          responseData = { success: false, message: closedTrainingEditRefusal };
          break;
        }

        const savedTrainings = saveTrainingRows(ss, payload.trainings || data.trainings);
        if (!savedTrainings) {
          responseData = { success: false, message: "The training sheet is missing." };
          break;
        }

        responseData = { success: true, ids: savedTrainings.ids, trainings: getSheetData(ss, "training") };
        logSystemEvent(
          ss,
          authTrainingEdit.userId,
          "SAVE_TRAINING",
          "Saved " + savedTrainings.count + " training(s)"
        );
        break;
      }

      case "ADMIN_BULK_SAVE_TRAINING": {
        const authTrainingSave = getAuthContext(ss, data);
        if (!authTrainingSave || !canAdministerTrainings(ss, authTrainingSave.userId)) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        // Unlike a member's own signature, an administrator manages every aspect of a
        // training: create, edit and delete. A row without a date AND a title is dropped by
        // normalizeTrainingList, so a half-filled form cannot write a blank training.
        const savedTrainings = saveTrainingRows(ss, payload.trainings || data.trainings);
        if (!savedTrainings) {
          responseData = { success: false, message: "The training sheet is missing." };
          break;
        }
        const trainingDeleteIds = payload.deleteIds || data.deleteIds || [];
        const deleteTrainingIds = Array.isArray(trainingDeleteIds) ? trainingDeleteIds : [];

        // An administrator manages everything about a training EXCEPT one that has been entered
        // into an external system: that is a closed record for everyone, so the lock is checked
        // here as well as in the member-facing action. Both the rows being written and the rows
        // being deleted are checked, since deleting is a modification too.
        const writtenTrainingIds = normalizeTrainingList(payload.trainings || data.trainings)
          .map(function (training) { return training.id; })
          .filter(function (id) { return id; });
        const adminRefusal = trainingWriteRefusal(ss, writtenTrainingIds.concat(deleteTrainingIds));
        if (adminRefusal) {
          responseData = { success: false, message: adminRefusal };
          break;
        }

        const removedTrainingCount = deleteTrainingIds.length
          ? bulkDeleteSheetRowsById(savedTrainings.sheet, deleteTrainingIds).length
          : 0;

        responseData = {
          success: true,
          ids: savedTrainings.ids,
          removed: removedTrainingCount,
          trainings: getSheetData(ss, "training")
        };
        logSystemEvent(
          ss,
          authTrainingSave.userId,
          "ADMIN_BULK_SAVE_TRAINING",
          "Saved " + savedTrainings.count + " training(s), removed " + removedTrainingCount
        );
        break;
      }

      case "ADMIN_REMOVE_TRAINING_SIGNATURE": {
        // The only way a signature is ever removed. Guarded by its own permission rather than
        // can_edit_trainings, because removing somebody else's acknowledgement is exactly the
        // thing that has to be deliberate.
        const authSignature = getAuthContext(ss, data);
        if (!authSignature || !canAdministerTrainings(ss, authSignature.userId)) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const signatureId = String(data.signature_id || payload.signature_id || "").trim();
        if (!signatureId) {
          responseData = { success: false, message: "A signature id is required." };
          break;
        }

        const signatureRows = getSheetData(ss, "training_signatures");
        const targetSignature = findRowById(signatureRows, signatureId);
        if (!targetSignature) {
          responseData = { success: false, message: "That signature no longer exists." };
          break;
        }

        // No signature changes on a closed training, for anyone. This is the check that makes
        // "locked" mean locked rather than merely "not editable in the module".
        const closedSignatureRefusal = trainingWriteRefusal(ss, [targetSignature.training_id]);
        if (closedSignatureRefusal) {
          responseData = { success: false, message: closedSignatureRefusal };
          break;
        }

        const removedSignatureCount = bulkDeleteSheetRowsById(
          ss.getSheetByName("training_signatures"),
          [signatureId]
        ).length;

        responseData = {
          success: true,
          removed: removedSignatureCount,
          // Named in the response so the confirmation message can be specific without the
          // client having to look the row up again after it has been deleted.
          training_id: String(targetSignature.training_id || ""),
          user_id: String(targetSignature.user_id || "")
        };
        logSystemEvent(
          ss,
          authSignature.userId,
          "ADMIN_REMOVE_TRAINING_SIGNATURE",
          "Removed signature " + signatureId + " (training " + String(targetSignature.training_id || "") +
            ", user " + String(targetSignature.user_id || "") + ")"
        );
        break;
      }

      case "ADMIN_SAVE_TIMECLOCK_ENTRY": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_timeclock")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const entryFields = {
          id: String(data.id || payload.id || ""),
          user_id: String(data.user_id || payload.user_id || ""),
          time_in: data.time_in || payload.time_in || "",
          time_out: data.time_out || payload.time_out || "",
          // Any entry created/edited through this admin action is considered manual
          is_manual: true
        };

        if (!entryFields.user_id || !entryFields.time_in) {
          responseData = { success: false, message: "User and time in are required." };
          break;
        }

        const savedEntryId = upsertSheetRowById(ss.getSheetByName("timeclock"), entryFields);
        responseData = { success: true, id: savedEntryId };

        logSystemEvent(ss, authCtx.userId, "ADMIN_SAVE_TIMECLOCK_ENTRY", "Admin saved timeclock entry " + savedEntryId + " for user " + entryFields.user_id);
        break;
      }

      case "ADMIN_DELETE_TIMECLOCK_ENTRY": {
        const authCtx = getAuthContext(ss, data);
        if (!authCtx || !hasRolePermission(ss, authCtx.userId, "can_edit_timeclock")) {
          responseData = { success: false, message: "Unauthorized." };
          break;
        }

        const targetEntryId = data.id || payload.id;
        const deletedEntry = deleteSheetRowById(ss.getSheetByName("timeclock"), targetEntryId);
        responseData = { success: deletedEntry, message: deletedEntry ? "Entry deleted." : "Entry not found." };

        if (deletedEntry) {
          logSystemEvent(ss, authCtx.userId, "ADMIN_DELETE_TIMECLOCK_ENTRY", "Admin deleted timeclock entry " + targetEntryId);
        }
        break;
      }

      default:
        // Names the action, because the usual cause of reaching here is a backend older than the page
        // that called it - and "Invalid action type." gives nobody anything to work with. The action
        // name is not a secret: the caller sent it.
        responseData = {
          success: false,
          code: "UNKNOWN_ACTION",
          message:
            "The server does not recognise the action \"" + action + "\". " +
            "If this is a new feature, the Apps Script deployment is probably older than this version of the app."
        };
        logSystemEvent(
          ss, 
          payload.user_id || "", 
          "UNKNOWN_ACTION", 
          "Invalid action attempted: " + action
        );
    }

    // MANDATORY: Return JSON ContentService output
    return ContentService
      .createTextOutput(JSON.stringify(responseData))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // An optimistic-concurrency refusal is a NORMAL outcome, not a server fault: the caller tried to write a
    // version of the record that is no longer current. It carries the row as it stands, so the page can show
    // what changed instead of pretending the save failed for an unknown reason.
    if (err && err.conflict) {
      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          code: "CONFLICT",
          message: err.message,
          current: err.conflict.current
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Return explicit error output instead of leaving request hanging
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);

  } finally {
    // Only release what was taken: a read-only action never acquired it.
    if (locked) lock.releaseLock();
  }
}

// HELPER FUNCTIONS (Outside doPost, at the bottom of the file)

// Normalizes one entry from a bulk schedule save. Returns null when the entry
// cannot be stored at all (it has no date).
//
// A blank user_id is KEPT, not rejected: a schedule row with no member is an OPEN
// shift - an unfilled slot the calendar draws as available and members may offer
// to fill. Requiring a member here silently dropped open shifts (the save still
// reported success), which is why this lives in its own function with tests.
//
// `includeTimes` writes the custom-shift window columns, which only exist on newer
// schedule sheets.
function normalizeScheduleEntry(raw, includeTimes) {
  const entry = raw || {};
  if (!String(entry.date_from || "")) return null;

  const fields = {
    id: String(entry.id || ""),
    schedule_template_id: String(entry.schedule_template_id || ""),
    date_from: String(entry.date_from || ""),
    date_to: String(entry.date_to || ""),
    apparatus_id: String(entry.apparatus_id || ""),
    assignment_id: String(entry.assignment_id || ""),
    // Trimmed because blankness is MEANINGFUL here: user_id === "" is what marks
    // the row as an open shift. A whitespace-only value would otherwise be stored
    // as a member id that resolves to nobody.
    user_id: String(entry.user_id || "").trim()
  };

  if (includeTimes) {
    fields.start_time = String(entry.start_time || "");
    fields.end_time = String(entry.end_time || "");
  }

  return fields;
}

// Normalizes an admin-entered colour to "#rrggbb". Returns "" for a blank value
// (meaning "no colour chosen") and null for anything that isn't a usable hex
// colour, so callers can reject it rather than store something no browser can
// render. Accepts 3- or 6-digit hex, with or without the leading '#'.
function normalizeHexColor(value) {
  const raw = String(value == null ? "" : value).trim();
  if (raw === "") return "";

  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(raw);
  if (!match) return null;

  let hex = match[1].toLowerCase();
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return "#" + hex;
}

// Member-visible projection of the assignments sheet, used by GET_SCHEDULE so a
// signed-in member can render assignment names and colours and filter the open
// shifts their rank actually qualifies for. Projected explicitly (rather than
// returning the whole row) so a future internal column on the assignments sheet
// is not exposed by accident.
function memberAssignmentRows(ss) {
  return getSheetData(ss, "assignments").map(function (row) {
    return {
      id: row.id,
      description: row.description,
      color: row.color,
      icon: row.icon,
      rank_order_required: row.rank_order_required,
      // The window travels with the assignment because the member calendar applies it too: a retired
      // assignment must stop offering shifts to members, not only to administrators.
      effective_date: toDateKeyValue(row.effective_date),
      end_date: toDateKeyValue(row.end_date)
    };
  });
}

// --- Announcements ---------------------------------------------------------------------------
//
// One rule, used by all three readers: an announcement is in force when today is inside its window, and
// aimed at a reader when every targeting column that is filled matches them. Blank means "anyone", so
// three blank columns reach everybody. The client mirrors this in utils/announcements.js.

function announcementIsLive(row, dateKey) {
  const from = toDateKeyValue(row.effective_date);
  const to = toDateKeyValue(row.end_date);
  if (from && dateKey < from) return false;
  if (to && dateKey > to) return false;
  return true;
}

function announcementMatches(row, roleId, rankId, userId) {
  const wantRole = String(row.role_id || "").trim();
  const wantRank = String(row.rank_id || "").trim();
  const wantUser = String(row.user_id || "").trim();
  if (wantRole && wantRole !== String(roleId || "").trim()) return false;
  if (wantRank && wantRank !== String(rankId || "").trim()) return false;
  if (wantUser && wantUser !== String(userId || "").trim()) return false;
  return true;
}

function announcementTargetsEveryone(row) {
  return !String(row.role_id || "").trim() && !String(row.rank_id || "").trim() && !String(row.user_id || "").trim();
}

// The announcements to show a particular reader, newest first.
//
// `locations` limits which of the three places count: the dashboard/sidebar call passes two so a
// login-only announcement is not shown twice to a signed-in member.
// --- Events -----------------------------------------------------------------
//
// Events are non-shift entries on the calendar. Two things about them differ from everything else here:
//
//   * They are returned to every signed-in member, filtered by the same kind of targeting the
//     announcements use (role AND rank AND member, with the rank rule being "and above"), because a
//     calendar is useless if half the crew cannot see what is on it.
//   * Nothing they do touches the schedule. An event is never written to the schedule sheet, never fills
//     a slot and never appears in an offer, so the only thing a bug here can do visually is draw wrong.
//
// `author_user_id` is stamped from the session on create and never accepted from a client, so the
// administration screen can reveal who created an event without trusting the request.

// The weekday columns, Sunday first, matching the sheet. Declared before the helper that reads them, so
// there is no load-order dependency to reason about.
var EVENT_WEEKDAY_COLUMNS = [
  "is_sunday",
  "is_monday",
  "is_tuesday",
  "is_wednesday",
  "is_thursday",
  "is_friday",
  "is_saturday",
];

// The repeating fields a save may set, normalised so the stored row is always usable.
//
// A blank amount becomes 1 rather than being stored as blank, because 1 is what "every day" means and a
// blank would have to be re-interpreted on every read. The weekday flags are only meaningful for weekly
// recurrence but are stored as given, so switching frequency back and forth in the form does not lose
// the ticks the admin made.
function eventFieldsFrom(data, payload) {
  const source = Object.assign({}, payload || {}, data || {});
  const recurring = isTruthySetting(source.is_recurring);
  const amount = parseInt(source.recurring_amount, 10);

  const fields = {
    id: String(source.id || "").trim(),
    title: String(source.title || "").trim(),
    date_from: String(source.date_from || "").trim(),
    date_to: String(source.date_to || "").trim(),
    color: String(source.color || "").trim(),
    role_id: String(source.role_id || "").trim(),
    rank_id: String(source.rank_id || "").trim(),
    user_id: String(source.user_id || "").trim(),
    is_recurring: recurring ? "TRUE" : "FALSE",
    // An all-day event occupies whole days, so its times are ignored when it is drawn.
    is_all_day: isTruthySetting(source.is_all_day) ? "TRUE" : "FALSE",
    recurring_start: String(source.recurring_start || "").trim(),
    recurring_end: String(source.recurring_end || "").trim(),
    recurring_amount: Number.isFinite(amount) && amount >= 1 ? String(amount) : "1",
    recurring_frequency: String(source.recurring_frequency || "").trim().toLowerCase(),
    date_of_month: String(source.date_of_month || "").trim(),
  };

  EVENT_WEEKDAY_COLUMNS.forEach(function (column) {
    fields[column] = isTruthySetting(source[column]) ? "TRUE" : "FALSE";
  });

  // A repeating event holds only the TIMES in date_from/date_to, so their dates are stamped with the repeat's
  // anchor. Otherwise they keep whatever day the form happened to be on when it was created, which reads in
  // the sheet as though the event happens on that day - it does not. Both columns are always strings of the
  // form "yyyy-mm-dd HH:mm"; the date part is replaced, the time part is kept.
  if (recurring && fields.recurring_start) {
    const anchor = toDateKeyValue(fields.recurring_start);
    if (anchor) {
      fields.date_from = anchor + eventTimeSuffix(fields.date_from);
      fields.date_to = anchor + eventTimeSuffix(fields.date_to);
    }
  }

  return fields;
}

// The time-of-day portion of a datetime cell as " HH:MM", or "" when it holds no time.
//
// Matched rather than sliced: the client sends "yyyy-mm-dd HH:mm" from the form but "yyyy-mm-ddTHH:mm" when
// editing an existing row, and slicing at a fixed offset would corrupt the second form.
function eventTimeSuffix(value) {
  const match = /(\d{1,2}:\d{2}(?::\d{2})?)\s*$/.exec(String(value === undefined || value === null ? "" : value).trim());
  return match ? " " + match[1] : "";
}

// Why a save should be refused, or "" when the row is usable.
//
// Mirrors utils/events.js#eventValidation so the form and the server agree. A repeat that can never
// produce an occurrence - weekly with no day ticked, monthly with no day of the month - is refused
// rather than stored, because it would look saved and simply never appear.
function eventValidationError(fields) {
  if (!fields.title) return "A title is required.";

  if (fields.is_recurring === "TRUE") {
    const start = toDateKeyValue(fields.recurring_start);
    if (!start) return "A start date is required for a recurring event.";

    if (["daily", "weekly", "monthly"].indexOf(fields.recurring_frequency) === -1) {
      return "Choose how often this event repeats.";
    }

    const amount = parseInt(fields.recurring_amount, 10);
    if (!Number.isFinite(amount) || amount < 1) {
      return "Repeat every must be a whole number of 1 or more.";
    }

    if (fields.recurring_frequency === "weekly") {
      const anyDay = EVENT_WEEKDAY_COLUMNS.some(function (column) {
        return fields[column] === "TRUE";
      });
      if (!anyDay) return "Tick at least one day of the week for a weekly event, or it would never appear.";
    }

    if (fields.recurring_frequency === "monthly") {
      const dayOfMonth = parseInt(fields.date_of_month, 10);
      if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        return "Choose a day of the month between 1 and 31.";
      }
    }

    const end = toDateKeyValue(fields.recurring_end);
    if (end && end < start) return "The repeat cannot end before it starts.";
    return "";
  }

  // A single event carries real dates, so they have to be ordered.
  const from = eventInstantValue(fields.date_from);
  if (!from) return "A start date and time is required.";

  // An all-day event has no times to order, so its dates are compared and read INCLUSIVELY: "Mar 1 to
  // Mar 3" is a valid three-day event. Its end date is optional, meaning a single day.
  if (fields.is_all_day === "TRUE") {
    const allDayTo = eventInstantValue(fields.date_to);
    if (allDayTo && allDayTo.key < from.key) return "The end has to be on or after the start date.";
    return "";
  }

  const to = eventInstantValue(fields.date_to);
  if (!to) return "An end date and time is required.";
  if (to.key < from.key || (to.key === from.key && to.minutes <= from.minutes)) {
    return "The end has to be after the start.";
  }
  return "";
}

// A datetime cell resolved to a local date key and minutes past midnight, or null.
//
// `new Date(...)` is only trusted for the ISO-with-time form, where the UTC instant is meaningful; a bare
// yyyy-mm-dd is read from the string, because Date would treat it as UTC midnight and could land on the
// previous day west of Greenwich.
function eventInstantValue(value) {
  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw) return null;

  if (/T\d{1,2}:\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) return null;
    return { key: toDateKeyValue(parsed), minutes: parsed.getHours() * 60 + parsed.getMinutes() };
  }

  const key = toDateKeyValue(raw);
  if (!key) return null;

  const named = /(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(raw);
  if (!named) return { key: key, minutes: 0 };

  const hours = Number(named[1]);
  const minutes = Number(named[2]);
  if (hours > 23 || minutes > 59) return null;
  return { key: key, minutes: hours * 60 + minutes };
}

// Every event one member should see on their calendars.
//
// The three targeting columns are ANDed, matching both the client rule and the announcements: fill one
// and only that group sees it. The rank rule differs from announcements - an event targets a rank AND
// ABOVE - so it needs rank ORDERS rather than ids, which is why both are resolved here.
//
// A viewer whose own rank cannot be resolved does not match a rank-targeted event: there is nothing to
// compare, and showing it to everybody is the worse way to be wrong.
function eventsForViewer(ss, viewerRow, userId) {
  const rankOrders = {};
  getSheetData(ss, "ranks").forEach(function (rank) {
    const order = parseInt(rank.rank_order, 10);
    if (Number.isFinite(order)) rankOrders[String(rank.id)] = order;
  });

  const ownOrder = rankOrders[String(viewerRow.rank_id)];
  const ownRole = String(viewerRow.role_id || "").trim();

  return getSheetData(ss, "events").filter(function (row) {
    const roleId = String(row.role_id || "").trim();
    if (roleId && roleId !== ownRole) return false;

    const memberId = String(row.user_id || "").trim();
    if (memberId && memberId !== String(userId)) return false;

    const rankId = String(row.rank_id || "").trim();
    if (rankId) {
      const required = rankOrders[rankId];
      if (required === undefined || ownOrder === undefined || ownOrder < required) return false;
    }

    return true;
  });
}

function announcementRowsFor(ss, options) {
  const opts = options || {};
  const dateKey = opts.dateKey || toDateKeyValue(new Date());
  const locations = opts.locations || null;
  const everyoneOnly = !!opts.everyoneOnly;

  return getSheetData(ss, "announcements")
    .filter(function (row) {
      return announcementIsLive(row, dateKey);
    })
    .filter(function (row) {
      return announcementMatches(row, opts.roleId, opts.rankId, opts.userId);
    })
    // The login screen has no reader, so it may only carry announcements aimed at everyone. Without
    // this a message targeted at one role would be readable by anybody standing at the keyboard.
    .filter(function (row) {
      return !everyoneOnly || announcementTargetsEveryone(row);
    })
    .filter(function (row) {
      if (!locations) return true;
      return locations.some(function (key) {
        return isTruthySetting(row[key]);
      });
    })
    .sort(function (a, b) {
      const aFrom = toDateKeyValue(a.effective_date);
      const bFrom = toDateKeyValue(b.effective_date);
      if (aFrom !== bFrom) return aFrom < bFrom ? 1 : -1;
      return String(b.id) > String(a.id) ? 1 : -1;
    });
}

// The sheet's booleans, in every form a spreadsheet cell can hold them.
function isTruthySetting(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  const text = String(value).trim().toUpperCase();
  return text === "TRUE" || text === "YES" || text === "1";
}

// The announcement fields a save may set, taken from the request. author_user_id is deliberately absent:
// the caller can neither forge it nor change it.
function announcementFieldsFrom(data, payload) {
  const read = function (key) {
    return data[key] !== undefined ? data[key] : payload[key];
  };

  return {
    id: String(data.id || payload.id || ""),
    title: String(read("title") || "").trim(),
    message: String(read("message") || "").trim(),
    effective_date: toDateKeyValue(read("effective_date")),
    end_date: toDateKeyValue(read("end_date")),
    is_visible_on_login: isTruthySetting(read("is_visible_on_login")),
    is_visible_on_dashboard: isTruthySetting(read("is_visible_on_dashboard")),
    is_visible_on_sidebar: isTruthySetting(read("is_visible_on_sidebar")),
    role_id: String(read("role_id") || "").trim(),
    rank_id: String(read("rank_id") || "").trim(),
    user_id: String(read("user_id") || "").trim(),
    icon: String(read("icon") || "").trim(),
    context_variant: String(read("context_variant") || "info").trim().toLowerCase(),
    is_send_push_notification: isTruthySetting(read("is_send_push_notification")),
    is_dismissable: isTruthySetting(read("is_dismissable"))
  };
}

// Why an announcement may not be saved, or "" when it may. The wording matches the client's own check
// (utils/announcements.js) so the two cannot disagree about what is required.
function announcementValidationError(fields, users) {
  if (!fields.title) return "A title is required.";
  if (!fields.message) return "A message is required.";
  if (!fields.effective_date) return "An effective date is required.";
  if (fields.end_date && fields.end_date < fields.effective_date) {
    return "The end date must not be before the effective date.";
  }
  if (!fields.is_visible_on_login && !fields.is_visible_on_dashboard && !fields.is_visible_on_sidebar) {
    return "Choose at least one place to show the announcement.";
  }

  // Targeting reaches nobody when the combination matches no member. Three blank columns reach everyone,
  // so there is nothing to check in that case.
  if (!fields.role_id && !fields.rank_id && !fields.user_id) return "";

  const reached = (Array.isArray(users) ? users : []).some(function (member) {
    if (fields.user_id && String(member.id) !== fields.user_id) return false;
    if (fields.role_id && String(member.role_id || "").trim() !== fields.role_id) return false;
    if (fields.rank_id && String(member.rank_id || "").trim() !== fields.rank_id) return false;
    return true;
  });

  return reached
    ? ""
    : "No members match that role, rank and member combination, so nobody would receive this announcement.";
}

// Pushes an announcement to the registered devices of everyone it is aimed at.
//
// Gated on the member's OWN announcement switch (notify_announcements), which falls back to the station
// default in system_settings. Turning it off silences the push and NOTHING else: the announcement still
// appears on the dashboard, in the sidebar and on the login screen, because the switch is about being
// interrupted, not about being told. That is why the in-app path never consults it.
//
// A member with no registered device is skipped, which is the same rule as every other push. The result is
// returned so the admin tab can report how many devices it reached.
function sendAnnouncementPush(ss, fields) {
  const config = fcmConfig(ss);
  if (!config.ready) return { sent: 0, skipped: 0, reason: "not-configured" };

  const index = userSettingsIndex(ss);
  const tokensByUser = pushTokenIndex(ss);
  const members = getSheetData(ss, "users");
  let sent = 0; // messages delivered, one per DEVICE - a member can have several
  let skipped = 0; // members with no registered device
  let muted = 0; // members who have turned announcement pushes off
  const staleTokens = [];

  members.forEach(function (member) {
    if (!announcementMatches(fields, member.role_id, member.rank_id, member.id)) return;

    const userRow = index[String(member.id)];
    if (!notificationEnabled(config.settings, userRow, "notify_announcements")) {
      muted++;
      return;
    }

    const devices = tokensByUser[String(member.id)] || [];
    if (!devices.length) {
      skipped++;
      return;
    }

    // Every device they have, so nobody has to nominate one.
    devices.forEach(function (token) {
      const result = sendFcmMessage(config, token, fields.title, fields.message, {
        event: "ANNOUNCEMENT",
        announcement_id: String(fields.id || "")
      });

      if (result.ok) {
        sent++;
      } else if (result.reason === "rejected") {
        // FCM says this registration is dead, so forget it rather than retrying forever. The TOKEN,
        // not the member: their other devices must keep working.
        staleTokens.push(token);
      }
    });
  });

  if (staleTokens.length) deletePushTokens(ss, staleTokens);
  return { sent: sent, skipped: skipped, muted: muted, reason: "" };
}

// The member-visible projection of the schedule_templates sheet, used by GET_SCHEDULE.

// Without this a member's calendar had no template data whatsoever, so shift windows,
// nicknames and unfilled template slots were all silently missing for them.
//
// The effective and end dates are included (normalized to yyyy-MM-dd) because the member
// calendar applies them too: a retired template must stop drawing slots for members, not only
// for administrators.
//
// Projected explicitly (like memberAssignmentRows) so a future internal column on the
// sheet is not exposed by accident.
function memberScheduleTemplateRows(ss) {
  return getSheetData(ss, "schedule_templates").map(function (row) {
    return {
      id: row.id,
      day_of_week: row.day_of_week,
      start_time: row.start_time,
      end_time: row.end_time,
      assignment_id: row.assignment_id,
      apparatus_id: row.apparatus_id,
      nickname: row.nickname,
      effective_date: toDateKeyValue(row.effective_date),
      end_date: toDateKeyValue(row.end_date)
    };
  });
}

// The runner leaderboard: personal bests above zero, highest first, capped.
//
// A blank or 0 cell means "has never played" rather than "scored nothing", so those members
// are left off the board instead of filling it with zeroes. Ties keep their sheet order,
// which is good enough for a game and avoids inventing a tiebreak nobody asked for.
//
// The projection is explicit (id, name, score), like the roster: a future internal column on
// the users sheet must not leak into a game payload. `total` is the full count so the client
// can say "top 25 of 40" rather than pretending the board is everyone.
function runnerLeaderboard(ss) {
  const rows = getSheetData(ss, "users")
    .map(function (row) {
      return {
        id: String(row && row.id !== undefined && row.id !== null ? row.id : ""),
        name: String((row && row.name) || "").trim(),
        score: Number(row && row.runner_score) || 0
      };
    })
    .filter(function (entry) {
      return entry.id !== "" && entry.score > 0;
    })
    .sort(function (a, b) {
      return b.score - a.score;
    });

  return { rows: rows.slice(0, RUNNER_LEADERBOARD_LIMIT), total: rows.length };
}

// The score to store for a finished run, or null when nothing should change.
//
// The score arrives from the client, so it is clamped to a sane positive integer first - a
// doctored request must not be able to write junk into the users sheet. A run then only ever
// IMPROVES a personal best, so a bad game cannot cost a member the board position a good one
// earned.
//
// Returning null rather than the unchanged score keeps a pointless sheet write (and its
// system log line) out of the way for the common case - most runs do not beat your best.
function runnerScoreToStore(currentBest, rawScore) {
  const previous = Number(currentBest) || 0;
  const parsed = parseInt(rawScore, 10);
  if (!isFinite(parsed)) return null;

  const score = Math.max(0, Math.min(parsed, RUNNER_SCORE_MAX));
  if (score <= 0 || score <= previous) return null;
  return score;
}

function getSheetData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  const results = [];

  for (let i = 1; i < values.length; i++) {
    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      rowObj[headers[j]] = values[i][j];
    }
    results.push(rowObj);
  }

  return results;
}

// Reads the "shifts" sheet, returning time columns as their on-screen display
// strings (e.g. "08:30" or "8:30 AM"). Time-formatted cells would otherwise
// come back as Date/ISO values that lose the wall-clock time the user sees
// when JSON-serialized, so the frontend uses these strings directly.
function getShiftsData(ss) {
  const sheet = ss.getSheetByName("shifts");
  if (!sheet) return [];

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  const results = [];

  for (let i = 1; i < values.length; i++) {
    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      const headerKey = headers[j];
      if (headerKey === "start_time" || headerKey === "end_time") {
        const display = String(
          displayValues[i][j] === undefined || displayValues[i][j] === null ? "" : displayValues[i][j]
        ).trim();
        rowObj[headerKey] = display;
      } else {
        rowObj[headerKey] = values[i][j];
      }
    }
    results.push(rowObj);
  }

  return results;
}

// The id a new record gets.
//
// A UUID rather than "the last row's id plus one", which is what this used to be. Sequential ids were REUSED
// after a delete: deleting the highest-id schedule row freed its id, and the next shift created inherited it -
// so a `schedule_offers.schedule_id` still on file silently pointed at a DIFFERENT shift, and an approval could
// fill the wrong slot. The bulk delete on the schedule board and the single-row deletes both opened that door.
//
// A UUID also removes the allocation READ, which was the last reason a create had to hold the script lock, and
// makes ids opaque: they can no longer be enumerated to watch the station's growth.
function newRowId() {
  return Utilities.getUuid();
}

// The ONE exception to that rule: a `system_log` row keeps a compact numeric id.
//
// Nothing references a log row - the sheet is appended to and read, never joined, edited or deleted by id - so
// the reuse problem does not apply to it, and a bare number keeps the log readable for a human scanning the
// sheet. Named for what it is, so it cannot be mistaken for the allocator the record sheets use.
function nextLogRowId(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1;
  const lastId = sheet.getRange(lastRow, 1).getValue();
  return (parseInt(lastId, 10) || 0) + 1;
}

// Checks the "roles" sheet for the is_admin flag tied to a user's role_id
// --- Session token helpers ---

// The session window when `session_timeout` is unset or unusable, and the smallest value treated as
// configured. MIN_* is what stops a typo like `0` expiring every session the moment it is saved.
const DEFAULT_SESSION_TTL_MINUTES = 12 * 60;
const MIN_SESSION_TTL_MINUTES = 1;

// How long a session lasts, in milliseconds, resolved from `session_timeout`.
//
// Read at exactly two moments - when a session is created, and when the setting itself is saved -
// and never on the request path. See the note above writeSessionRecord for why, and retuneSessions
// for how a change reaches sessions that are already open.
function sessionTtlMs(ss) {
  let ttlMs = DEFAULT_SESSION_TTL_MINUTES * 60 * 1000;
  try {
    const minutes = parseSessionTimeoutMinutes(systemSettingsMap(ss).session_timeout);
    if (minutes !== null) ttlMs = minutes * 60 * 1000;
  } catch (settingsErr) {
    // Unreadable settings mean "no idle timeout configured", not "lock everyone out".
  }
  return ttlMs;
}

// A session record: "userId|expiry|ttlMs|epoch".
//
// The WINDOW IS CARRIED IN THE RECORD rather than looked up per request: that is the whole performance design
// of this feature. Reading the setting on every authenticated request would cost a sheet read (or a cache
// round trip that can evict), and refreshing a session then becomes a property write and a couple of parseInt
// calls - no sheet read, no cache, no eviction tail. The trade is that a change only reaches an OPEN session
// through retuneSessions, which the settings save calls.
//
// The EPOCH is what makes a revocation stick. Sliding expiry rewrites a session on every authenticated
// request, including the read-only ones that hold no lock - so a "sign out everyone" that deleted the token
// could have it written straight back by a request that had already validated it, and the session survived
// until it idled out. The epoch is the authority instead: bumping it invalidates every record that carries an
// older one, however many times the record itself is rewritten.
//
// Field 2 is still an absolute expiry, field 3 is the window, and field 4 is new, so a record written by an
// earlier deploy (two or three fields) still works: it has no epoch, and the epoch it is compared against
// starts empty too, so nobody is signed out merely by deploying this.
function parseSessionRecord(stored) {
  const parts = String(stored || "").split("|");
  const ttlMs = parseInt(parts[2], 10);
  return {
    userId: parts[0],
    expiry: parseInt(parts[1], 10),
    ttlMs: ttlMs && ttlMs > 0 ? ttlMs : DEFAULT_SESSION_TTL_MINUTES * 60 * 1000,
    epoch: String(parts[3] === undefined || parts[3] === null ? "" : parts[3]),
  };
}

// Every live session is a Script Property under this prefix.
//
// The "fc_" is historical - the app was called Fire Clock when this was written - and it is deliberately NOT
// renamed with the app. It appears in six places across the create / look-up / revoke / cleanup paths, and none of
// them can be covered by the test suite because PropertiesService cannot be stubbed there; a typo in one of them
// would break sign-in for everyone with nothing to catch it. Renaming it would also invalidate every live session
// and orphan the existing records, which would then never be swept. It is invisible to members, so it stays.
const SESSION_PROPERTY_PREFIX = "fc_auth_";

// The per-user session epoch, bumped when every session for that member is revoked.
//
// Deliberately NOT under SESSION_PROPERTY_PREFIX: every loop that walks sessions filters on that prefix, and a
// second key space hiding inside it would be read as a session record and deleted as one.
const SESSION_EPOCH_PREFIX = "fc_epoch_";

// The epoch a new session should carry: empty until something is revoked, so a deployment that adds this
// changes nobody's session.
function sessionEpochFor(userId) {
  const key = String(userId === undefined || userId === null ? "" : userId).trim();
  if (!key) return "";
  try {
    return String(PropertiesService.getScriptProperties().getProperty(SESSION_EPOCH_PREFIX + key) || "");
  } catch (err) {
    return ""; // an unreadable epoch must not lock anybody out
  }
}

// Invalidates every session that carries an older epoch, and returns the new one.
function bumpSessionEpoch(userId) {
  const key = String(userId === undefined || userId === null ? "" : userId).trim();
  if (!key) return "";
  const next = String(Date.now());
  PropertiesService.getScriptProperties().setProperty(SESSION_EPOCH_PREFIX + key, next);
  return next;
}

function sessionRecordValue(userId, expiry, ttlMs, epoch) {
  return String(userId) + "|" + expiry + "|" + ttlMs + "|" + String(epoch === undefined || epoch === null ? "" : epoch);
}

function createSession(userId, ss) {
  const token = Utilities.getUuid();
  const ttlMs = sessionTtlMs(ss);
  PropertiesService.getScriptProperties().setProperty(
    SESSION_PROPERTY_PREFIX + token,
    sessionRecordValue(userId, Date.now() + ttlMs, ttlMs, sessionEpochFor(userId))
  );
  return token;
}

// Re-expresses every live session against the currently configured window.
//
// Called when `session_timeout` is saved, which is what lets the request path never look the
// setting up: the change is pushed to open sessions instead of them polling for it. Elapsed idle
// time is preserved - a session idle for 20 of 30 minutes becomes 20 of the new window - so
// shortening the timeout applies immediately without giving everyone a fresh full window.
//
// Returns how many sessions were retuned, for the admin's response.
function retuneSessions(ss) {
  const props = PropertiesService.getScriptProperties();
  const ttlMs = sessionTtlMs(ss);
  const now = Date.now();
  let updated = 0;

  props.getKeys().forEach(function (key) {
    if (key.indexOf(SESSION_PROPERTY_PREFIX) !== 0) return;
    const record = parseSessionRecord(props.getProperty(key));
    if (!record.userId || !record.expiry || now > record.expiry) return;

    // When the session was last used: its expiry minus the window it was created with.
    const lastSeen = record.expiry - record.ttlMs;
    // The epoch rides along: dropping it here would turn a retuned session into a legacy one, and every member
    // who has ever been revoked would be signed out by the next timeout change.
    props.setProperty(key, sessionRecordValue(record.userId, lastSeen + ttlMs, ttlMs, record.epoch));
    updated++;
  });

  return updated;
}

// Strict, and null when unusable: a typo must fall back to the default rather than expire every
// session the moment it is saved. Mirrors parseSessionTimeoutMinutes on the client.
function parseSessionTimeoutMinutes(raw) {
  const value = String(raw === undefined || raw === null ? "" : raw).trim();
  if (value === "") return null;
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const minutes = Number(value);
  if (!isFinite(minutes) || minutes < MIN_SESSION_TTL_MINUTES) return null;
  return Math.floor(minutes);
}

// Resolves a request's session token back to the authenticated user.
// Returns { userId, user } or null if the token is missing/invalid/expired.
function getAuthContext(ss, data) {
  const props = PropertiesService.getScriptProperties();
  const req = data || {};
  const token = String(req.token || (req.payload && req.payload.token) || "");
  if (!token) return null;

  const stored = props.getProperty(SESSION_PROPERTY_PREFIX + token);
  if (!stored) return null;

  // The window travels in the record, so this is the entire sliding-expiry cost: parse, compare,
  // write. No settings lookup and no cache round trip on the request path - see parseSessionRecord.
  const record = parseSessionRecord(stored);
  const userId = record.userId;
  if (!record.expiry || Date.now() > record.expiry) {
    props.deleteProperty(SESSION_PROPERTY_PREFIX + token);
    return null;
  }

  // A session that predates the member's last revocation is refused, however fresh its expiry looks. This is
  // what stops the sliding-expiry write below from resurrecting a session that was just revoked: the record
  // may exist, but it is no longer entitled to.
  if (record.epoch !== sessionEpochFor(userId)) {
    props.deleteProperty(SESSION_PROPERTY_PREFIX + token);
    return null;
  }

  const users = getSheetData(ss, "users");
  const user = users.find(function (u) {
    return String(u.id) === String(userId);
  });
  if (!user) return null;

  // Sliding expiration: push the expiry out by the window this session already carries.
  props.setProperty(SESSION_PROPERTY_PREFIX + token, sessionRecordValue(userId, Date.now() + record.ttlMs, record.ttlMs));

  return { userId: String(userId), user: user };
}

// Deletes all sessions for a user, optionally keeping the supplied one (used
// after a password change so the current user isn't logged out).
//
// Revocation is enforced by the EPOCH, not by the deletion alone: deleting the records is still worth doing
// (it frees the properties and is instant for everyone who is not mid-request), but a session that a
// concurrent request had already validated could be written straight back. With the epoch bumped, that
// resurrected record carries a stale one and is refused on its next use.
//
// The kept session is re-stamped with the new epoch, or the member who just changed their own password would
// be signed out of the device they are using.
function revokeSessionsForUser(userId, exceptToken) {
  const props = PropertiesService.getScriptProperties();
  const keep = String(exceptToken || "");
  const epoch = bumpSessionEpoch(userId);

  props.getKeys().forEach(function (k) {
    if (k.indexOf(SESSION_PROPERTY_PREFIX) !== 0) return;
    if (keep && k === SESSION_PROPERTY_PREFIX + keep) {
      const kept = parseSessionRecord(props.getProperty(k));
      if (kept.userId) props.setProperty(k, sessionRecordValue(kept.userId, kept.expiry, kept.ttlMs, epoch));
      return;
    }
    const val = props.getProperty(k) || "";
    if (val.split("|")[0] === String(userId)) props.deleteProperty(k);
  });
}

// Removes expired session entries (called opportunistically on login).
function cleanupExpiredSessions() {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  props.getKeys().forEach(function (k) {
    if (k.indexOf(SESSION_PROPERTY_PREFIX) !== 0) return;
    const expiry = parseInt((props.getProperty(k) || "").split("|")[1], 10);
    if (expiry && now > expiry) props.deleteProperty(k);
  });
}

// The roles row held by a member, or null. Shared by every permission check
// below so they all resolve the role the same way.
function roleForUser(ss, userId) {
  if (!userId) return null;

  const users = getSheetData(ss, "users");
  const user = users.find(function (u) {
    return String(u.id) === String(userId);
  });
  if (!user) return null;

  const roles = getSheetData(ss, "roles");
  const role = roles.find(function (r) {
    return String(r.id) === String(user.role_id);
  });
  return role || null;
}

// Roles-sheet column lookup that tolerates hand-edited headers.
//
// The sheet is maintained by hand, so a header can differ from the permission key only
// in case, spacing or underscores ("Can_Edit_Users", "can edit users",
// "can_edit_users "). An exact match would read those as not granted and silently hide
// the tab. Mirrors roleColumnValue() in src/utils/permissions.js so the UI and the
// server always agree on what a role may do.
function normalizeRoleColumnName(name) {
  return String(name == null ? "" : name).trim().toLowerCase().replace(/[\s_-]+/g, "");
}

// The value of a role column, matched by normalized name, or undefined if absent.
function roleColumnValue(role, key) {
  if (!role) return undefined;
  if (Object.prototype.hasOwnProperty.call(role, key)) return role[key];

  var wanted = normalizeRoleColumnName(key);
  var actual = Object.keys(role).find(function (column) {
    return normalizeRoleColumnName(column) === wanted;
  });
  return actual === undefined ? undefined : role[actual];
}

// True when a role column is present and switched on (boolean true or the text TRUE).
function roleFlagValue(role, key) {
  var raw = roleColumnValue(role, key);
  return raw === true || String(raw == null ? "" : raw).trim().toUpperCase() === "TRUE";
}

function isAdminUser(ss, userId) {
  const role = roleForUser(ss, userId);
  if (!role) return false;
  return roleFlagValue(role, "is_admin");
}

// Whether the member's role grants one permission column.
//
// `is_admin` implies every permission, so an administrator never needs the
// individual flags set - which is also what the Roles tab shows by locking them on.
//
// The column is looked up BY NAME (case/space/underscore-insensitively), so the
// permission list lives only in the client (src/utils/permissions.js) and adding a new
// column there needs no change here.
function hasRolePermission(ss, userId, permissionKey) {
  const role = roleForUser(ss, userId);
  if (!role) return false;
  if (roleFlagValue(role, "is_admin")) return true;
  return roleFlagValue(role, permissionKey);
}

// True when the role grants AT LEAST ONE of the listed permissions - for actions
// (or read endpoints) that more than one job needs, such as the offers table.
function hasAnyRolePermission(ss, userId, permissionKeys) {
  return permissionKeys.some(function (key) {
    return hasRolePermission(ss, userId, key);
  });
}

// Inserts or updates a row in an "id"-keyed sheet based on fields.id; returns the row's id
// Optimistic concurrency for single-record saves.
//
// Every admin form that edits ONE record reads the row, shows it, and later writes back a handful of fields.
// Two administrators with the same form open therefore end with the last save winning and the first one's
// change silently gone. Rather than a lock (which cannot be held across a form) the row carries a version:
// the caller sends back the version it loaded, and a mismatch is refused with the row as it now stands.
//
// ABSENT VERSION MEANS NO CHECK. That is deliberate and it is the compatibility lever: the page and the
// backend are deployed separately, so a client built before this must keep saving. It is also what keeps the
// bulk writers (a month of schedule rows at once) out of the scheme - they do not send a version, so they are
// never refused and never invalidate anyone.
const ROW_VERSION_COLUMN = "row_version";
const ROW_VERSION_FIRST = 1;

// Adds the version column to a sheet that does not have one yet, and starts every existing row at 1.
//
// Idempotent, so it can run on the write path instead of needing a migration step - after the first save of a
// given sheet it costs one header read. Appended at the END, so an admin's own columns keep their positions.
function ensureRowVersionColumn(sheet) {
  if (!sheet) return -1;

  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 1) return -1;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const existing = headers.indexOf(ROW_VERSION_COLUMN);
  if (existing !== -1) return existing;

  const col = lastCol + 1;
  sheet.getRange(1, col).setValue(ROW_VERSION_COLUMN);
  if (lastRow > 1) {
    const versions = [];
    for (let i = 0; i < lastRow - 1; i++) versions.push([ROW_VERSION_FIRST]);
    sheet.getRange(2, col, lastRow - 1, 1).setValues(versions);
  }
  return col - 1;
}

// The refusal thrown when a caller is writing a version of the row that is no longer current. doPost turns it
// into a CONFLICT reply carrying the row as it stands, which is what the caller needs to reload and reapply.
function rowVersionConflict_(id, currentRow, headers) {
  const current = {};
  headers.forEach(function (header, index) {
    const key = String(header === undefined || header === null ? "" : header).trim();
    if (key) current[key] = currentRow[index];
  });

  const err = new Error(
    "Someone else changed this record while you were editing it, so your change was NOT saved. " +
      "Reload it and apply your change again."
  );
  err.conflict = { id: String(id), current: current };
  return err;
}

function upsertSheetRowById(sheet, fields) {
  ensureRowVersionColumn(sheet);

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf("id");
  const versionCol = headers.indexOf(ROW_VERSION_COLUMN);

  let targetId = fields.id ? String(fields.id) : null;
  let rowIndex = -1;

  if (targetId) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === targetId) {
        rowIndex = i + 1; // 1-based row index
        break;
      }
    }
  }

  if (rowIndex === -1) {
    // No existing row matched, so this is a new record
    if (!targetId) targetId = String(newRowId());
    const newRow = headers.map(function (h) {
      if (h === "id") return targetId;
      if (h === ROW_VERSION_COLUMN) return ROW_VERSION_FIRST;
      return fields[h] !== undefined ? fields[h] : "";
    });
    sheet.appendRow(newRow);
  } else {
    const currentRow = data[rowIndex - 1];

    // The check, before any write: a caller that sent the version it loaded is telling us which state it
    // edited, and a different one means somebody got there first.
    const supplied = fields[ROW_VERSION_COLUMN];
    if (versionCol !== -1 && supplied !== undefined && supplied !== null && String(supplied).trim() !== "") {
      const stored = String(currentRow[versionCol] === undefined || currentRow[versionCol] === null ? "" : currentRow[versionCol]).trim();
      if (stored !== String(supplied).trim()) throw rowVersionConflict_(targetId, currentRow, headers);
    }

    const nextVersion = versionCol === -1 ? 0 : (parseInt(currentRow[versionCol], 10) || 0) + 1;

    // One setValues call for the whole row is dramatically faster than one
    // setValue per column (each SpreadsheetApp write has real overhead).
    // Unsupplied fields keep their current values, exactly as before.
    const width = Math.max(currentRow.length, headers.length);
    const nextRow = [];
    for (let c = 0; c < width; c++) {
      const h = headers[c];
      if (h === "id") {
        nextRow.push(currentRow[c]);
      } else if (h === ROW_VERSION_COLUMN) {
        // Never client-supplied: the version is ours to advance, and a caller must not be able to set it.
        nextRow.push(nextVersion);
      } else if (h !== undefined && fields[h] !== undefined) {
        nextRow.push(fields[h]);
      } else {
        nextRow.push(c < currentRow.length ? currentRow[c] : "");
      }
    }
    sheet.getRange(rowIndex, 1, 1, width).setValues([nextRow]);
  }

  return targetId;
}

// Bulk upsert for save-everything flows: reads the sheet ONCE, writes each
// updated row with a single setValues, appends every new row in one setValues
// block. Returns the id assigned to each entry, in the same order as the
// entries array.
//
// New rows get a UUID each (see newRowId), so a bulk save no longer has to
// allocate ids from the sheet it is about to write - the "sequential ids after
// the current max" this used to do was the last place a create depended on
// reading the sheet first.
function bulkUpsertSheetRowsById(sheet, entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return [];

  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = lastRow > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const idCol = headers.indexOf("id");

  // Pathological sheet (no headers/id column): fall back to the single-row
  // helper so behavior matches the non-bulk path.
  if (idCol === -1) {
    return list.map((raw) => upsertSheetRowById(sheet, raw || {}));
  }

  // Index the existing rows by id in a single read.
  const existing = {};
  if (lastRow > 1) {
    const dataValues = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (let i = 0; i < dataValues.length; i++) {
      const idVal = String(dataValues[i][idCol] ?? "").trim();
      if (idVal) existing[idVal] = { values: dataValues[i], sheetRow: i + 2 };
    }
  }

  const updates = [];
  const appends = [];
  const ids = [];

  for (let i = 0; i < list.length; i++) {
    const fields = list[i] || {};
    const requestedId = fields.id ? String(fields.id).trim() : "";

    if (requestedId && Object.prototype.hasOwnProperty.call(existing, requestedId)) {
      const currentRow = existing[requestedId].values;
      const width = Math.max(currentRow.length, headers.length);
      const nextRow = [];
      for (let c = 0; c < width; c++) {
        const h = headers[c];
        if (h === "id") {
          nextRow.push(currentRow[c]);
        } else if (h !== undefined && fields[h] !== undefined) {
          nextRow.push(fields[h]);
        } else {
          nextRow.push(c < currentRow.length ? currentRow[c] : "");
        }
      }
      updates.push({ row: existing[requestedId].sheetRow, values: nextRow });
      ids.push(requestedId);
    } else {
      const assignedId = requestedId || String(newRowId());
      const rowValues = headers.map((h) => {
        if (h === "id") return assignedId;
        return fields[h] !== undefined ? fields[h] : "";
      });
      appends.push(rowValues);
      ids.push(assignedId);
    }
  }

  for (let i = 0; i < updates.length; i++) {
    sheet.getRange(updates[i].row, 1, 1, updates[i].values.length).setValues([updates[i].values]);
  }
  if (appends.length) {
    sheet.getRange(lastRow + 1, 1, appends.length, headers.length).setValues(appends);
  }

  return ids;
}

// Deletes every row whose id matches one of the given ids in a single pass
// (rows are removed bottom-up so earlier indices stay valid). Returns the
// number of rows removed.
function bulkDeleteSheetRowsById(sheet, ids) {
  const wanted = (Array.isArray(ids) ? ids : []).map((id) => String(id).trim()).filter(Boolean);
  if (!wanted.length) return 0;

  const wantedSet = {};
  for (let i = 0; i < wanted.length; i++) wantedSet[wanted[i]] = true;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idCol = headers.indexOf("id");
  if (idCol === -1) return 0;

  const dataValues = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const rowsToDelete = [];
  for (let i = dataValues.length - 1; i >= 0; i--) {
    const idVal = String(dataValues[i][idCol] ?? "").trim();
    if (idVal && wantedSet[idVal]) rowsToDelete.push(i + 2);
  }
  for (let i = 0; i < rowsToDelete.length; i++) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  return rowsToDelete.length;
}

// Deletes the row matching the given id in an "id"-keyed sheet; returns true if a row was removed
function deleteSheetRowById(sheet, id) {
  if (!sheet || !id) return false;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf("id");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// Deletes every row whose given column matches the value; returns count removed
function removeRowsWhere(sheet, colName, value) {
  if (!sheet) return 0;
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const col = headers.indexOf(colName);
  if (col === -1) return 0;
  let removed = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col]) === String(value)) {
      sheet.deleteRow(i + 1);
      removed++;
    }
  }
  return removed;
}

// The member's OPEN timeclock entry, or null. An entry is open while time_out is blank.
//
// One definition, used by BOTH halves of the timeclock: clock-out stamps the row this returns, and clock-in
// refuses to open a second one while a member has an entry. Two hand-written searches is how the two halves
// drift apart - and a duplicate open entry is not self-correcting: it needs an administrator to spot it.
//
// Scans from the BOTTOM, so the most recent entry wins if a legacy duplicate ever exists.
function findOpenClockRow(sheet, userId, cachedRows) {
  if (!sheet || !userId) return null;
  const rows = cachedRows || sheet.getDataRange().getValues();
  if (!rows.length) return null;

  const headers = rows[0];
  const userIdCol = headers.indexOf("user_id");
  const timeOutCol = headers.indexOf("time_out");
  if (userIdCol === -1 || timeOutCol === -1) return null;

  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][userIdCol]) == String(userId) && !rows[i][timeOutCol]) {
      return { sheetRow: i + 1, row: rows[i] }; // sheetRow is 1-based, as Sheets counts
    }
  }
  return null;
}

// Builds a sheet row from a field map using the sheet's OWN header order.
//
// The availability sheet is (id, schedule_template_id, date_from, date_to,
// apparatus_id, assignment_id, user_id) - note user_id LAST, which is not the order any
// other sheet uses. A positional write would quietly put a member id into a date column
// the first time somebody reorders that sheet, so every row is mapped through the headers.
function rowValuesForHeaders(headers, fields) {
  return headers.map(function (header) {
    const key = String(header == null ? "" : header).trim();
    return Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : "";
  });
}

// Applies a BATCH of availability changes in one pass over the sheet.
//
// Marking a month's shifts a click at a time cost one request AND one full sheet read per
// click, so the client now reports what changed and this does: one read, the deletions
// bottom-up, then every addition in a single setValues write.
//
// The row key is still (member, template, date), which keeps the batch idempotent: a slot
// that is already marked is cleared and re-added rather than duplicated, and removing a
// slot that was never marked is a no-op. A malformed entry is skipped rather than failing
// the whole batch.
//
// Returns { ok, added, cleared, skipped, message }.
function setAvailabilityRows(ss, userId, rawAdds, rawRemoves) {
  const memberId = String(userId == null ? "" : userId).trim();
  if (!memberId) return { ok: false, message: "A member is required." };

  const sheet = ss.getSheetByName("availability");
  if (!sheet) return { ok: false, message: "The availability sheet is missing." };

  const values = sheet.getDataRange().getValues();
  const headers = values.length ? values[0] : [];
  const userCol = headers.indexOf("user_id");
  const templateCol = headers.indexOf("schedule_template_id");
  const fromCol = headers.indexOf("date_from");
  if (userCol === -1 || templateCol === -1 || fromCol === -1) {
    return {
      ok: false,
      message: "The availability sheet needs user_id, schedule_template_id and date_from columns."
    };
  }

  const slotsIn = function (raw) {
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i] || {};
      const templateId = String(item.schedule_template_id || "").trim();
      const dateFrom = toDateKeyValue(item.date_from);
      if (!templateId || !dateFrom) continue;
      out.push({
        templateId: templateId,
        dateFrom: dateFrom,
        dateTo: toDateKeyValue(item.date_to) || dateFrom
      });
    }
    return out;
  };

  const addSlots = slotsIn(rawAdds);
  const removeSlots = slotsIn(rawRemoves);
  const touched = removeSlots.concat(addSlots);

  const matchesSlot = function (slot, row) {
    if (String(row[userCol]).trim() !== memberId) return false;
    if (String(row[templateCol]).trim() !== slot.templateId) return false;
    return toDateKeyValue(row[fromCol]) === slot.dateFrom;
  };

  // Delete every row a removal OR an addition refers to, so an addition can never
  // duplicate a row that is already there. Bottom-up, because deleting a row shifts the
  // rows below it.
  const rowIndexes = [];
  for (let i = 1; i < values.length; i++) {
    for (let s = 0; s < touched.length; s++) {
      if (matchesSlot(touched[s], values[i])) {
        rowIndexes.push(i);
        break;
      }
    }
  }
  for (let i = rowIndexes.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowIndexes[i] + 1);
  }

  // Additions. The assignment and apparatus come from the TEMPLATE, never the request: a
  // member must not be able to record availability against an assignment the template is
  // not for.
  const templateRows = getSheetData(ss, "schedule_templates");
  const written = {};
  const newRows = [];
  let skipped = 0;

  for (let i = 0; i < addSlots.length; i++) {
    const slot = addSlots[i];
    const key = slot.templateId + "|" + slot.dateFrom;
    if (written[key]) continue;
    written[key] = true;

    const template = findRowById(templateRows, slot.templateId);
    if (!template) {
      skipped++;
      continue;
    }

    newRows.push(
      rowValuesForHeaders(headers, {
        // A UUID, so the additions no longer depend on running AFTER the deletions to pick a free number.
        id: String(newRowId()),
        schedule_template_id: slot.templateId,
        date_from: slot.dateFrom,
        date_to: slot.dateTo,
        apparatus_id: String(template.apparatus_id || ""),
        assignment_id: String(template.assignment_id || ""),
        user_id: memberId
      })
    );
  }

  // One write for the whole batch, directly beneath the rows that survived.
  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }

  return { ok: true, added: newRows.length, cleared: rowIndexes.length, skipped: skipped };
}

// Inserts or updates a row in a key/value sheet (e.g. system_settings)
function upsertKeyValueRow(sheet, keyCol, valueCol, keyName, value) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyIdx = headers.indexOf(keyCol);
  const valIdx = headers.indexOf(valueCol);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyIdx]) === String(keyName)) {
      sheet.getRange(i + 1, valIdx + 1).setValue(value);
      return;
    }
  }
  sheet.appendRow([keyName, value]);
}

// Deletes the row matching keyName in a key/value sheet; returns true if a row was removed
function deleteKeyValueRow(sheet, keyCol, keyName) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyIdx = headers.indexOf(keyCol);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyIdx]) === String(keyName)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// How many settings one batch may carry, and how long a key may be. Both are guard rails against a request
// that would otherwise write an unbounded number of rows: the app's largest batch is the ten loading messages.
const SETTINGS_BATCH_LIMIT = 50;
const SETTING_KEY_MAX_LENGTH = 64;

// The pairs a batch save was asked for: [{ key, value }], values coerced to strings, duplicates collapsed to
// the LAST occurrence (so a caller that sends the same key twice gets what it meant, not a double write).
//
// Tolerant by design: `settings` arrives over the wire from a page that may be older than this deployment.
function settingPairsFrom(rawSettings) {
  const pairs = [];
  const indexByKey = {};

  (Array.isArray(rawSettings) ? rawSettings : []).forEach(function (entry) {
    if (!entry) return;
    const key = String(entry.key === undefined || entry.key === null ? "" : entry.key).trim();
    if (!key) return;
    const value = entry.value === undefined || entry.value === null ? "" : String(entry.value);

    if (Object.prototype.hasOwnProperty.call(indexByKey, key)) {
      pairs[indexByKey[key]].value = value;
      return;
    }
    indexByKey[key] = pairs.length;
    pairs.push({ key: key, value: value });
  });

  return pairs.slice(0, SETTINGS_BATCH_LIMIT);
}

// Why a batch should be refused, or "" when it is usable.
//
// Checked as a WHOLE before the first write, which is what makes the batch atomic: a batch that is half
// applied is exactly the outcome this action exists to remove (the Loading Messages card used to issue ten
// separate requests, so a failure part-way left the messages half updated).
function settingBatchRefusal(rawSettings, options) {
  const opts = options || {};
  const pairs = settingPairsFrom(rawSettings);

  if (!pairs.length) return "No settings were supplied.";
  if ((Array.isArray(rawSettings) ? rawSettings : []).length > SETTINGS_BATCH_LIMIT) {
    return "That is too many settings to save at once (limit " + SETTINGS_BATCH_LIMIT + ").";
  }

  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].key.length > SETTING_KEY_MAX_LENGTH) {
      return "That setting key is too long (limit " + SETTING_KEY_MAX_LENGTH + " characters).";
    }
    // A notifications-only role may edit the notify_* keys and nothing else - the same rule the single-key
    // action applies, checked here for every pair so none can ride along on a permitted one.
    if (opts.canEditNotificationsOnly && !opts.canEditAll && pairs[i].key.indexOf("notify_") !== 0) {
      return "Changing system settings requires the 'Manage system settings' permission.";
    }
  }

  return "";
}

// Writes many settings in ONE request and ONE pass over the sheet: a single read to find the existing rows, one
// cell write per row that exists (they need not be adjacent, so they cannot share a range), and one setValues
// for every row that has to be created. Returns the keys written, in order.
//
// The single-pair upsertKeyValueRow re-reads the whole sheet per key, so ten loading messages cost ten requests
// and ten full reads inside the lock. This is what makes the batch worth having: the ten messages are one
// request, and a failure anywhere in it leaves the sheet as it was.
function setSystemSettingsBatch(ss, pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  if (!list.length) return [];

  let sheet = ss.getSheetByName("system_settings");
  if (!sheet) {
    sheet = ss.insertSheet("system_settings");
    sheet.appendRow(["key", "value"]);
  }

  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const keyCol = headers.indexOf("key");
  const valueCol = headers.indexOf("value");
  if (keyCol === -1 || valueCol === -1) return [];

  const rowByKey = {};
  if (lastRow > 1) {
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (let i = 0; i < data.length; i++) {
      const key = String(data[i][keyCol] == null ? "" : data[i][keyCol]).trim();
      if (key && !Object.prototype.hasOwnProperty.call(rowByKey, key)) rowByKey[key] = i + 2;
    }
  }

  const appends = [];
  const written = [];

  list.forEach(function (pair) {
    const existing = rowByKey[pair.key];
    // One cell each, so no read-modify-write of the row is needed: only the value column changes.
    if (existing) sheet.getRange(existing, valueCol + 1).setValue(pair.value);
    else appends.push(rowValuesForHeaders(headers, { key: pair.key, value: pair.value }));
    written.push(pair.key);
  });

  if (appends.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, headers.length).setValues(appends);
  }

  return written;
}

// Utility: Log events to system_log sheet
// ============================================================================
// Shift offers (member -> admin request/approval flow)
//
// The `schedule_offers` sheet mirrors the `schedule` columns (schedule_template_id,
// date_from, date_to, assignment_id, user_id) and adds:
//   schedule_id  - the `schedule` row that was filled (only set on approval)
//   approved_by  - admin user id that approved the offer
//   declined_by  - admin user id that declined the offer
// A row is PENDING while both approved_by and declined_by are blank.
// ============================================================================

function pad2(value) {
  const s = String(value);
  return s.length < 2 ? "0" + s : s;
}

// Station-timezone "yyyy-MM-dd" key for a sheet value (Date cell, "MM/DD/YYYY",
// "yyyy-MM-dd" or an ISO string). Offers compare dates as strings, so every path
// has to normalize first.
function toDateKeyValue(value) {
  if (value === undefined || value === null || value === "") return "";
  if (value instanceof Date) {
    return Utilities.formatDate(value, "America/New_York", "yyyy-MM-dd");
  }

  const s = String(value).trim();
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return mdy[3] + "-" + pad2(mdy[1]) + "-" + pad2(mdy[2]);

  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) return ymd[1] + "-" + pad2(ymd[2]) + "-" + pad2(ymd[3]);

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, "America/New_York", "yyyy-MM-dd");
  }
  return "";
}

function todayDateKey() {
  return Utilities.formatDate(new Date(), "America/New_York", "yyyy-MM-dd");
}

// Sheet booleans arrive as TRUE/FALSE text, real booleans, or 1/0.
function isTruthyValue(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  const s = String(value).trim().toUpperCase();
  return s === "TRUE" || s === "1" || s === "YES";
}

function findRowById(rows, id) {
  const wanted = String(id === undefined || id === null ? "" : id).trim();
  if (!wanted) return null;
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i++) {
    const rowId = list[i].id;
    if (String(rowId === undefined || rowId === null ? "" : rowId).trim() === wanted) return list[i];
  }
  return null;
}

// pending | approved | declined - derived from the two stamp columns.
function offerStatus(offer) {
  if (!offer) return "";
  if (String(offer.approved_by || "").trim() !== "") return "approved";
  if (String(offer.declined_by || "").trim() !== "") return "declined";
  return "pending";
}

// Stable identity of the shift a row targets: the schedule row when one is
// known, otherwise the weekly template occurrence ("slot"). The member calendar
// labels its open pills with these same keys, so offer state can be attached to
// a pill without any extra lookups.
function slotKeyOfOffer(row) {
  if (!row) return "";
  const scheduleId = String(row.schedule_id || "").trim();
  if (scheduleId) return "row-" + scheduleId;
  const dateKey = toDateKeyValue(row.date_from);
  const templateId = String(row.schedule_template_id || "").trim();
  if (!dateKey || !templateId) return "";
  return "slot-" + dateKey + "-" + templateId;
}

// Adds the derived fields the clients rely on: status, normalized date keys and
// the slot key.
function normalizeOffer(offer) {
  if (!offer) return null;
  const out = {};
  const keys = Object.keys(offer);
  for (let i = 0; i < keys.length; i++) out[keys[i]] = offer[keys[i]];
  out.status = offerStatus(offer);
  out.date_key = toDateKeyValue(offer.date_from);
  out.date_to_key = toDateKeyValue(offer.date_to) || out.date_key;
  out.slot_key = slotKeyOfOffer(offer);
  return out;
}

function offersForUser(ss, userId) {
  const wanted = String(userId === undefined || userId === null ? "" : userId).trim();
  if (!wanted) return [];
  return getSheetData(ss, "schedule_offers")
    .filter(function (o) { return String(o.user_id || "").trim() === wanted; })
    .map(normalizeOffer);
}

function describeShiftOffer(offer) {
  if (!offer) return "unknown shift";
  const parts = [
    toDateKeyValue(offer.date_from),
    offer.assignment_id ? "assignment " + offer.assignment_id : "",
    offer.schedule_template_id ? "template " + offer.schedule_template_id : "",
    offer.user_id ? "member " + offer.user_id : ""
  ];
  return parts.filter(Boolean).join(" / ");
}

// Reads + normalizes the offer fields posted by the member calendar.
function readShiftOfferFields(data) {
  const payload = data.payload || {};
  const pick = function (key) {
    const direct = data[key];
    if (direct !== undefined && direct !== null && String(direct) !== "") return String(direct).trim();
    const nested = payload[key];
    return nested === undefined || nested === null ? "" : String(nested).trim();
  };
  return {
    id: "",
    schedule_template_id: pick("schedule_template_id"),
    date_from: toDateKeyValue(pick("date_from")),
    date_to: toDateKeyValue(pick("date_to")),
    assignment_id: pick("assignment_id"),
    user_id: "",
    schedule_id: pick("schedule_id"),
    approved_by: "",
    declined_by: ""
  };
}

// Confirms the requested shift is still unfilled and returns the `schedule` row
// it maps to (blank for a weekly template occurrence with no row yet).
function resolveOpenShift(ss, fields) {
  const scheduleRows = getSheetData(ss, "schedule");
  const requestedKey = toDateKeyValue(fields.date_from);

  // The member offered on an existing (unassigned) row, e.g. a custom shift.
  if (fields.schedule_id) {
    const row = findRowById(scheduleRows, fields.schedule_id);
    if (!row) return { ok: false, message: "That shift no longer exists." };
    if (String(row.user_id || "").trim() !== "") {
      return { ok: false, message: "That shift has already been filled." };
    }
    return { ok: true, scheduleId: String(row.id) };
  }

  const templateId = String(fields.schedule_template_id || "").trim();
  if (!templateId) return { ok: false, message: "That shift is no longer available." };
  const template = findRowById(getSheetData(ss, "schedule_templates"), templateId);
  if (!template) return { ok: false, message: "That shift's template no longer exists." };

  for (let i = 0; i < scheduleRows.length; i++) {
    const row = scheduleRows[i];
    if (String(row.schedule_template_id || "").trim() !== templateId) continue;
    const from = toDateKeyValue(row.date_from);
    const to = toDateKeyValue(row.date_to) || from;
    if (!from || !to || requestedKey < from || requestedKey > to) continue;
    // A row already covers this occurrence: only an unfilled one is offerable.
    if (String(row.user_id || "").trim() !== "") {
      return { ok: false, message: "That shift has already been filled." };
    }
    return { ok: true, scheduleId: String(row.id) };
  }

  // Uncovered template occurrence - nothing exists in the sheet for it yet.
  return { ok: true, scheduleId: "" };
}

// Mirrors the client-side rank rule (utils/rankEligibility.js): a higher numeric
// rank_order is a higher rank, and a member may fill their own rank and every
// lower one. Members also have to be schedulable at all.
function canUserFillAssignment(ss, user, assignment) {
  if (!user) return false;
  if (isTruthyValue(user.exclude_from_scheduling)) return false;

  const status = String(user.status || "").trim().toLowerCase();
  if (status && status !== "active") return false;

  const required = parseInt(assignment && assignment.rank_order_required, 10);
  if (!isFinite(required)) return true; // no minimum -> anyone still in the pool

  const rank = findRowById(getSheetData(ss, "ranks"), user.rank_id);
  const order = rank ? parseInt(rank.rank_order, 10) : NaN;
  return isFinite(order) && order >= required;
}

// Approving an offer fills the shift: the row the offer points at (or any
// unfilled row for the same slot) gets the member, and a template occurrence
// that has no row yet gets a freshly created schedule entry.
function fillShiftFromOffer(ss, offer, adminUserId) {
  const scheduleSheet = ss.getSheetByName("schedule");
  if (!scheduleSheet) return { ok: false, message: "The schedule sheet is missing." };

  const userId = String(offer.user_id || "").trim();
  if (!userId) return { ok: false, message: "That offer has no member on it." };

  const scheduleRows = getSheetData(ss, "schedule");
  const offerKey = slotKeyOfOffer(offer);

  let target = offer.schedule_id ? findRowById(scheduleRows, offer.schedule_id) : null;
  if (!target) {
    target = scheduleRows.find(function (row) {
      return String(row.user_id || "").trim() === "" && slotKeyOfOffer(row) === offerKey;
    });
  }
  if (target && String(target.user_id || "").trim() !== "") {
    return { ok: false, message: "That shift has already been filled." };
  }

  if (target) {
    // Only the member changes - dates/assignment/apparatus stay as scheduled.
    upsertSheetRowById(scheduleSheet, { id: String(target.id), user_id: userId });
    return { ok: true, scheduleId: String(target.id) };
  }

  const template = findRowById(getSheetData(ss, "schedule_templates"), offer.schedule_template_id);
  const dateFrom = toDateKeyValue(offer.date_from);
  if (!dateFrom) return { ok: false, message: "That offer has no valid date." };

  const newId = upsertSheetRowById(scheduleSheet, {
    id: "",
    schedule_template_id: String(offer.schedule_template_id || ""),
    date_from: dateFrom,
    date_to: toDateKeyValue(offer.date_to) || dateFrom,
    apparatus_id: template ? String(template.apparatus_id || "") : "",
    assignment_id: String(offer.assignment_id || (template ? template.assignment_id : "") || ""),
    user_id: userId
  });
  return { ok: true, scheduleId: String(newId) };
}

// ============================================================================
// Push-notification seam
// ============================================================================

// Every shift-offer state change funnels through here, so wiring a real push
// provider later (FCM / OneSignal / etc.) only has to touch this one function.
// The single seam between the shift-offer flow and notifications: every offer
// state change lands here, is recorded in `system_log`, and is then pushed to
// the people who need to know about it.
function notifyShiftOffer(ss, event, offer, actorUserId) {
  if (!offer) return null;

  const recipients = event === "SUBMITTED"
    ? shiftApproverUserIds(ss) // whoever can approve has to act on a new offer
    : [String(offer.user_id || "").trim()].filter(Boolean); // the member hears the outcome

  const payload = {
    event: "SHIFT_OFFER_" + event,
    offer_id: String(offer.id || ""),
    schedule_id: String(offer.schedule_id || ""),
    schedule_template_id: String(offer.schedule_template_id || ""),
    assignment_id: String(offer.assignment_id || ""),
    date_from: toDateKeyValue(offer.date_from),
    date_to: toDateKeyValue(offer.date_to) || toDateKeyValue(offer.date_from),
    offer_user_id: String(offer.user_id || "").trim(),
    actor_user_id: String(actorUserId || "").trim(),
    recipient_user_ids: recipients
  };

  logSystemEvent(ss, actorUserId, payload.event, JSON.stringify(payload));

  // The push carries a data block, so the clients refetch GET_SHIFT_OFFERS /
  // ADMIN_GET_SCHEDULE_OFFERS and render from the sheet rather than from a
  // stale payload. sendShiftOfferPush swallows its own errors, and this guard
  // means a push problem can never break the offer/approval flow itself.
  try {
    sendShiftOfferPush(ss, event, payload);
  } catch (err) {
    Logger.log("Push send failed: " + err.toString());
  }

  return payload;
}

// Everyone whose role can approve shifts: the people Pending Approvals exists for,
// and the people a new shift request is worth telling. `is_admin` implies the
// permission, so administrators are included without needing the column set.
//
// This used to be adminUserIds (is_admin only), which no longer matches the app:
// approvals are gated on can_approve_shifts, so delivery is too.
function shiftApproverUserIds(ss) {
  const approverRoleIds = getSheetData(ss, "roles")
    .filter(function (r) {
      return roleFlagValue(r, "is_admin") || roleFlagValue(r, "can_approve_shifts");
    })
    .map(function (r) { return String(r.id); });

  return getSheetData(ss, "users")
    .filter(function (u) { return approverRoleIds.indexOf(String(u.role_id)) !== -1; })
    .map(function (u) { return String(u.id); });
}

// ============================================================================
// FCM (Firebase Cloud Messaging) delivery
//
// Credentials live in `system_settings` so an admin can finish the setup from
// Administration > System > Notifications without redeploying the script:
//   fcm_web_config                   - Firebase web config JSON (browser side)
//   fcm_vapid_public_key             - Web Push certificate key pair (browser)
//   fcm_service_account_email        - service account client_email (server)
//   fcm_service_account_private_key  - service account private_key (server)
// Per-member opt-ins live in `user_settings` and may be blank, which means
// "inherit the station default":
//   fcm_token / notify_new_offer / notify_offer_approved / notify_offer_declined
// ============================================================================

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_OAUTH_URL = "https://oauth2.googleapis.com/token";

// The scope Apps Script needs before UrlFetchApp can make any external call.
// Surfaced verbatim in the UI so an admin can match it against the consent
// dialog. Apps Script detects this automatically from the code, unless the
// project manifest pins an explicit oauthScopes list.
const FCM_SCOPE_HINT = "https://www.googleapis.com/auth/script.external_request";

// Every scope this project needs, in the order they should appear if the
// manifest pins an explicit `oauthScopes` list. Derived from the services the
// script actually uses:
//   SpreadsheetApp  -> spreadsheets
//   UrlFetchApp     -> script.external_request
// Utilities/PropertiesService/CacheService/LockService need no scope, and
// Session.* is never called (only the word "Session" appears, in messages).
// An explicit list disables auto-detection, so this must stay complete.
const FCM_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  FCM_SCOPE_HINT
];

function systemSettingsMap(ss) {
  const map = {};
  getSheetData(ss, "system_settings").forEach(function (row) {
    if (row && row.key !== undefined && String(row.key).trim() !== "") {
      map[String(row.key).trim()] = row.value;
    }
  });
  return map;
}

// ============================================================================
// Redaction for the unauthenticated GET_INITIAL_DATA payload
//
// Anyone holding the deployment URL can call that action, so these helpers
// remove values that must never reach a client:
//   - FCM service-account credentials (they can push to every member)
//   - per-device FCM tokens (they identify one member's device)
// Browsers do need fcm_web_config and fcm_vapid_public_key - both are public by
// design (the VAPID *private* half stays with Firebase) - so those pass through.
// ============================================================================

// ============================================================================
// RUNNER SOUND PROFILE
// ============================================================================
//
// A member's `runner_sound_profile` on their user_settings row is a PREFIX for the Firefighter
// Runner's sound files: `bird` means the game looks for bird-jump.wav, bird-die.wav and
// bird-point.wav, and an empty value means the defaults. It is set from the Administration Users
// tab and deliberately guarded by is_admin rather than can_edit_users - it is a cosmetic station
// setting, not part of running the roster.
//
// Validated with the same rule the client uses (src/utils/runnerSounds.js): letters, digits, dash
// and underscore, or empty. A profile is used to build a filename, so an odd value is refused with
// an explanation rather than silently rewritten into something the administrator did not type.
const RUNNER_SOUND_PROFILE_PATTERN = /^[A-Za-z0-9_-]+$/;

function normalizeRunnerSoundProfile(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function runnerSoundProfileIsValid(profile) {
  return profile === "" || RUNNER_SOUND_PROFILE_PATTERN.test(profile);
}

// ============================================================================

// ============================================================================
// CLOCK LOCATION (optional geofence)
// ============================================================================

// Imperial feet per metre, matching the client's utils/clockLocation.js.
const FEET_PER_METER = 3.280839895;

function clockLocationNumber(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const text = String(raw).trim();
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) return null;
  const parsed = Number(text);
  return isFinite(parsed) ? parsed : null;
}

// The station geofence, or null when it is not fully configured. Partial configuration counts as
// off, matching the client: a station that has filled in one or two keys keeps clocking in as it
// always has, rather than being locked out of its own timeclock by a half-finished setup.
function requiredClockLocation(ss) {
  const settings = {};
  getSheetData(ss, "system_settings").forEach(function (row) {
    if (row && row.key !== undefined) settings[String(row.key)] = row.value;
  });

  const latitude = clockLocationNumber(settings.required_clock_latitude);
  const longitude = clockLocationNumber(settings.required_clock_longitude);
  const marginFeet = clockLocationNumber(settings.gps_margin_of_error);

  if (latitude === null || latitude < -90 || latitude > 90) return null;
  if (longitude === null || longitude < -180 || longitude > 180) return null;
  if (marginFeet === null || marginFeet <= 0) return null;

  return { latitude: latitude, longitude: longitude, marginFeet: marginFeet };
}

// Great-circle distance in feet.
function distanceInFeet(fromLat, fromLon, toLat, toLon) {
  const toRad = function (degrees) { return (degrees * Math.PI) / 180; };
  const lat1 = toRad(fromLat);
  const lat2 = toRad(toLat);
  const deltaLat = toRad(toLat - fromLat);
  const deltaLon = toRad(toLon - fromLon);
  const a = Math.pow(Math.sin(deltaLat / 2), 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(deltaLon / 2), 2);
  const meters = 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
  return meters * FEET_PER_METER;
}

// Rejection message for a clock action, or "" when it may proceed.
//
// Enforced here as well as in the UI because the fence is the whole point: a member who edited the
// request in a browser console would otherwise bypass it entirely. Manual entries raised by an
// administrator go through ADMIN_SAVE_TIMECLOCK_ENTRY, which is a different action and so is
// deliberately unaffected.
function clockLocationRejection(ss, rawLat, rawLon) {
  const fence = requiredClockLocation(ss);
  if (!fence) return "";

  const latitude = clockLocationNumber(rawLat);
  const longitude = clockLocationNumber(rawLon);
  if (latitude === null || longitude === null) {
    return "Your location could not be determined, so this clock action was rejected. Allow location access for this site and try again.";
  }

  const feet = distanceInFeet(latitude, longitude, fence.latitude, fence.longitude);
  if (feet > fence.marginFeet) {
    return "You are about " + Math.round(feet) + " ft from the station, outside the " +
      Math.round(fence.marginFeet) + " ft limit. Move closer and try again.";
  }
  return "";
}

// ============================================================================



// ============================================================================
// TRAINING
// ============================================================================
//
// Two sheets: `training` (one row per activity) and `training_signatures` (one row per
// member per training). Three permissions drive it:
//
//   can_sign_trainings       open the Training module and sign
//   can_edit_trainings       add/change training activities (implies can_sign_trainings)
//   can_administer_trainings  the Training report: signatures for everyone, and removal
//
// A signature is an acknowledgement of attendance, so members can only ADD one - the
// member-facing action refuses to remove. Only can_administer_trainings can remove, and
// that goes through a separate admin action. Keeping the two actions apart is what makes
// the rule enforceable rather than a UI convention.

const TRAINING_BOOL_COLUMNS = [
  "is_certification",
  "is_drill",
  "is_fire_prevention",
  "is_multicompany",
  "is_training_facility",
  "is_officer_training",
  "is_driver_training",
  "is_entered_into_external"
];

// Fields the training form owns, other than the flags. `duration` is a float in hours.
const TRAINING_TEXT_COLUMNS = ["date", "title", "start_time", "duration", "location", "instructors", "narrative"];

function normalizeTrainingRow(raw) {
  const source = raw || {};
  const training = { id: String(source.id || "").trim() };
  TRAINING_TEXT_COLUMNS.forEach(function (column) {
    training[column] = source[column] === undefined || source[column] === null ? "" : source[column];
  });
  // Stored as the text TRUE/FALSE the rest of the sheets use, so a spreadsheet reader sees
  // the same thing the app does.
  TRAINING_BOOL_COLUMNS.forEach(function (column) {
    training[column] = isTruthyValue(source[column]) ? "TRUE" : "FALSE";
  });
  return training;
}

// A training row is only usable if it has a date and a title; without them there is nothing
// to show in a table and nothing to sign. Rows missing either are skipped rather than
// written as blanks, which is what the schedule board does with its own entries.
function trainingRowIsUsable(training) {
  return String(training.date || "").trim() !== "" && String(training.title || "").trim() !== "";
}

function normalizeTrainingList(rawList) {
  return (Array.isArray(rawList) ? rawList : [])
    .map(normalizeTrainingRow)
    .filter(trainingRowIsUsable);
}

// Signatures for one training, or for one member, depending on which is supplied. The row id
// travels with each so the report can remove a signature.
function normalizeSignatureRowsFor(ss, trainingId, userId) {
  return getSheetData(ss, "training_signatures")
    .map(function (row) {
      return {
        id: String((row && row.id) || "").trim(),
        training_id: String((row && row.training_id) || "").trim(),
        user_id: String((row && row.user_id) || "").trim()
      };
    })
    .filter(function (signature) {
      if (!signature.training_id || !signature.user_id) return false;
      if (trainingId && signature.training_id !== String(trainingId)) return false;
      if (userId && signature.user_id !== String(userId)) return false;
      return true;
    });
}

// A member's own signatures. Deliberately filtered by member id on the server: a member has
// no business seeing who else attended, and doing the filtering here means the payload cannot
// leak the rest even if the client asked for it.
function trainingSignaturesForUser(ss, userId) {
  return normalizeSignatureRowsFor(ss, "", userId);
}

function canSignTrainings(ss, userId) {
  return hasRolePermission(ss, userId, "can_sign_trainings");
}

function canAdministerTrainings(ss, userId) {
  return hasRolePermission(ss, userId, "can_administer_trainings");
}

// Training rows keyed by id, for the lock and signature checks below.
function trainingRowsById(ss) {
  const byId = {};
  getSheetData(ss, "training").forEach(function (row) {
    const id = String((row && row.id) || "").trim();
    if (id) byId[id] = row;
  });
  return byId;
}

// A training that has been entered into an external system is a CLOSED record: nothing about it
// or its signatures may change again, for anyone. That includes an administrator, which is why
// this is checked in every training action rather than only in the member-facing ones. The only
// way back is clearing the column in the spreadsheet.
function trainingIsClosed(row) {
  return isTruthyValue(row && row.is_entered_into_external);
}

// How many members have signed each training, keyed by training id.
function trainingSignatureCounts(ss) {
  const counts = {};
  normalizeSignatureRowsFor(ss, "", "").forEach(function (signature) {
    const id = signature.training_id;
    counts[id] = (counts[id] || 0) + 1;
  });
  return counts;
}

// The training list as the app sees it: every row plus its signature count.
//
// The count is not decoration - the Training module must know whether ANYONE has signed a
// training before it offers an Edit button, and a member only ever receives their own
// signatures, so without this the client cannot answer that question. A count does not reveal
// who signed.
function trainingRowsForApp(ss) {
  const counts = trainingSignatureCounts(ss);
  return getSheetData(ss, "training").map(function (row) {
    const copy = Object.assign({}, row);
    const id = String((row && row.id) || "").trim();
    copy.signature_count = counts[id] || 0;
    return copy;
  });
}

// A message explaining why a set of training ids cannot be changed, or "" when they all can.
// Used by the actions that write, so the rule is enforced in one place and reported in words
// the UI can show as-is.
function trainingWriteRefusal(ss, ids) {
  const byId = trainingRowsById(ss);
  const refused = (Array.isArray(ids) ? ids : []).filter(function (rawId) {
    const id = String(rawId || "").trim();
    return id && trainingIsClosed(byId[id]);
  });
  if (!refused.length) return "";
  return "Training " + refused.join(", ") +
    " has been entered into an external system and is locked, so it cannot be changed.";
}

// Writes a batch of training rows, returning their ids. Shared by SAVE_TRAINING (a role with
// can_edit_trainings, which may add and change) and ADMIN_BULK_SAVE_TRAINING (which may also
// delete), so the two cannot drift on how a training is stored.
function saveTrainingRows(ss, rawTrainings) {
  const trainingSheet = ss.getSheetByName("training");
  if (!trainingSheet) return null;
  const entries = normalizeTrainingList(rawTrainings);
  return {
    sheet: trainingSheet,
    count: entries.length,
    ids: entries.length ? bulkUpsertSheetRowsById(trainingSheet, entries) : []
  };
}

// ============================================================================



// system_settings keys that are credentials rather than configuration.
const SECRET_SETTING_KEY = /private_key|service_account|server_key|client_secret|password|secret/i;

function publicSystemSettings(ss) {
  return getSheetData(ss, "system_settings").filter(function (row) {
    return !row || !SECRET_SETTING_KEY.test(String(row.key || ""));
  });
}

// The client only needs to know whether this device is registered, never the
// token itself, so the token is replaced by a boolean. Tokens are also
// write-only from then on - see updateUserSettingsValues.
function publicUserSettings(ss) {
  return getSheetData(ss, "user_settings").map(function (row) {
    const safeRow = Object.assign({}, row);
    safeRow.fcm_registered = String(safeRow.fcm_token || "").trim() !== "";
    delete safeRow.fcm_token;
    return safeRow;
  });
}

function fcmConfig(ss) {
  const settings = systemSettingsMap(ss);
  let projectId = String(settings.fcm_project_id || "").trim();

  // The project id is also inside the web config, so admins only have to paste
  // that one blob for the browser side to work.
  if (!projectId) {
    try {
      const webConfig = JSON.parse(String(settings.fcm_web_config || "{}"));
      projectId = String((webConfig && webConfig.projectId) || "").trim();
    } catch (err) {
      projectId = "";
    }
  }

  // Service-account credentials are read from Script Properties first. That
  // store is invisible to anyone the spreadsheet is shared with, and nothing
  // returns it. The system_settings fallback keeps the admin UI working for
  // stations that would rather keep everything in one place.
  const scriptProps = PropertiesService.getScriptProperties();
  const propEmail = scriptProps.getProperty("FCM_SERVICE_ACCOUNT_EMAIL");
  const propKey = scriptProps.getProperty("FCM_SERVICE_ACCOUNT_PRIVATE_KEY");

  // Service account JSON escapes newlines as \n; the PEM parser needs them real.
  const privateKey = String(propKey || settings.fcm_service_account_private_key || "")
    .replace(/\\n/g, "\n")
    .trim();
  const clientEmail = String(propEmail || settings.fcm_service_account_email || "").trim();

  return {
    settings: settings,
    projectId: projectId,
    clientEmail: clientEmail,
    privateKey: privateKey,
    credentialSource: propKey ? "script_properties" : "system_settings",
    ready: !!projectId && !!clientEmail && !!privateKey
  };
}

// All `user_settings` rows keyed by user id so one read serves every recipient.
function userSettingsIndex(ss) {
  const index = {};
  getSheetData(ss, "user_settings").forEach(function (row) {
    const raw = row.user_id !== undefined && row.user_id !== "" ? row.user_id : row.id;
    const id = String(raw === undefined || raw === null ? "" : raw).trim();
    if (id) index[id] = row;
  });
  return index;
}

// Precedence: member override -> station default -> on.
function notificationEnabled(settings, userRow, key) {
  const override = userRow ? userRow[key] : "";
  if (override !== undefined && override !== null && String(override).trim() !== "") {
    return isTruthyValue(override);
  }

  const stationDefault = settings[key];
  if (stationDefault === undefined || stationDefault === null || String(stationDefault).trim() === "") {
    return true;
  }
  return isTruthyValue(stationDefault);
}

// OAuth2 bearer token for FCM HTTP v1 (an access token, not a legacy server
// key), signed from the service account and cached until shortly before expiry.
function fcmAccessToken(config) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("fcm_access_token");
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const encode = function (value) {
    return Utilities.base64EncodeWebSafe(JSON.stringify(value)).replace(/=+$/, "");
  };

  const unsigned = encode({ alg: "RS256", typ: "JWT" }) + "." + encode({
    iss: config.clientEmail,
    scope: FCM_SCOPE,
    aud: FCM_OAUTH_URL,
    iat: now,
    exp: now + 3600
  });

  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(unsigned, config.privateKey)
  ).replace(/=+$/, "");

  const response = UrlFetchApp.fetch(FCM_OAUTH_URL, {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + signature
    },
    muteHttpExceptions: true
  });

  const body = JSON.parse(response.getContentText());
  if (!body.access_token) {
    throw new Error("FCM auth failed (" + response.getResponseCode() + "): " + response.getContentText());
  }

  cache.put("fcm_access_token", body.access_token, Math.max(60, (body.expires_in || 3600) - 300));
  return body.access_token;
}

// Why a send failed, which decides what the admin is told to do about it.
// "rejected" means FCM itself answered and refused; the other reasons mean the
// request never left Apps Script (or never authenticated), and need completely
// different fixes - so they must not be reported as an FCM rejection.
function classifyFcmFailure(detail) {
  const text = String(detail || "");

  // The script was never granted UrlFetchApp access. Fix by running a function
  // from the editor once (which raises the consent dialog) and redeploying.
  if (/script\.external_request|do not have permission to call|authorization is required|required permissions/i.test(text)) {
    return "auth_scope";
  }

  // We reached Google's token endpoint but the service account was refused.
  if (/FCM auth failed/i.test(text)) {
    return "auth_service_account";
  }

  // Couldn't reach the network at all.
  if (/Service invoked too many times|DNS error|Address unavailable|timed out/i.test(text)) {
    return "network";
  }

  return "rejected";
}

// Human-readable next step for each failure reason, shown in the admin tab.
function fcmFailureAdvice(reason) {
  if (reason === "auth_scope") {
    return "The script is not authorized for external requests yet (" + FCM_SCOPE_HINT +
      "). Run diagnoseFcmSetup in the Apps Script editor and follow its instructions, then deploy a new version.";
  }
  if (reason === "auth_service_account") {
    return "Firebase refused the service account. Check that the service account email and private key in this tab belong to the same Firebase project and that the private key was copied in full.";
  }
  if (reason === "network") {
    return "Apps Script could not reach Google's servers. Try again in a moment.";
  }
  return "";
}

// Sends one message to one device. Returns { ok, code, detail, reason } and
// never throws, so a single bad token can't stop delivery to the other
// recipients.
function sendFcmMessage(config, token, title, body, data) {
  try {
    const response = UrlFetchApp.fetch(
      "https://fcm.googleapis.com/v1/projects/" + config.projectId + "/messages:send",
      {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + fcmAccessToken(config) },
        payload: JSON.stringify({
          message: {
            token: token,
            // The notification block keeps Apple web push working (it ignores
            // data-only messages). Browsers that display it themselves are
            // de-duplicated in public/sw.js.
            notification: { title: title, body: body },
            data: Object.assign({ title: title, body: body }, data || {}),
            webpush: { headers: { Urgency: "high" } }
          }
        }),
        muteHttpExceptions: true
      }
    );

    const code = response.getResponseCode();
    return { ok: code === 200, code: code, detail: response.getContentText() };
  } catch (err) {
    // A thrown exception means the request never reached FCM, which is almost
    // always a missing OAuth scope or a rejected service account. Reporting
    // that as "FCM rejected the message" sends admins hunting in the wrong
    // place, so the reason is classified and the truth is surfaced.
    return { ok: false, code: 0, detail: err.toString(), reason: classifyFcmFailure(err) };
  }
}

// Copy + opt-in key for each shift-offer event. Adding an event type only needs
// a branch here plus a matching toggle in the admin and member UIs.
function shiftOfferPushCopy(event, payload) {
  const from = payload.date_from || "";
  const to = payload.date_to || from;
  const when = to && to !== from ? from + " to " + to : from;
  const span = when ? " (" + when + ")" : "";

  if (event === "SUBMITTED") {
    return {
      prefKey: "notify_new_offer",
      title: "New shift request",
      body: "A member offered to take an open shift" + span + "."
    };
  }
  if (event === "APPROVED") {
    return {
      prefKey: "notify_offer_approved",
      title: "Shift request approved",
      body: "The shift you offered to take" + span + " was approved."
    };
  }
  if (event === "DECLINED") {
    return {
      prefKey: "notify_offer_declined",
      title: "Shift request declined",
      body: "The shift you offered to take" + span + " was declined."
    };
  }
  return null;
}

// Delivers a shift-offer event to its recipients, honouring each member's
// opt-in and skipping anyone who has never registered a device.
function sendShiftOfferPush(ss, event, payload) {
  const config = fcmConfig(ss);
  if (!config.ready) return; // FCM not configured yet - nothing to send

  const copy = shiftOfferPushCopy(event, payload);
  if (!copy) return;

  const index = userSettingsIndex(ss);
  const tokensByUser = pushTokenIndex(ss);
  const recipients = Array.isArray(payload.recipient_user_ids) ? payload.recipient_user_ids : [];
  const staleTokens = [];
  let delivered = 0;

  recipients.forEach(function (userId) {
    const key = String(userId);
    const userRow = index[key];

    if (!notificationEnabled(config.settings, userRow, copy.prefKey)) return;

    const devices = tokensByUser[key] || [];
    if (!devices.length) return; // member has no registered device

    // Every device the member has registered, not just the most recent one.
    devices.forEach(function (token) {
      const result = sendFcmMessage(config, token, copy.title, copy.body, {
        event: payload.event,
        offer_id: payload.offer_id || "",
        schedule_id: payload.schedule_id || "",
        date_from: payload.date_from || "",
        date_to: payload.date_to || payload.date_from || ""
      });

      if (result.ok) {
        delivered++;
        return;
      }

      Logger.log("FCM send failed for user " + key + " (" + result.code + "): " + result.detail);

      // FCM reports dead registrations; drop them so we stop retrying forever.
      // Auth/config failures say nothing about the token, so they never clear it.
      const failureReason = result.reason || classifyFcmFailure(result.detail);
      if (failureReason === "rejected" && (result.code === 404 || /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/i.test(String(result.detail)))) {
        staleTokens.push(token);
      }
    });
  });

  if (staleTokens.length) deletePushTokens(ss, staleTokens);

  Logger.log("PUSH_SHIFT_OFFER_" + event + ": delivered " + delivered + " device(s) for " + recipients.length + " recipient(s)");
}

// Writes the supplied columns onto a member's `user_settings` row, appending a
// row (and any missing header cells) when needed. Columns that aren't listed
// keep their current value, which is what lets the settings form and the
// device-registration flow share one endpoint.
function upsertUserSettingsColumns(ss, userId, values) {
  const targetId = String(userId === undefined || userId === null ? "" : userId).trim();
  if (!targetId) return false;

  let sheet = ss.getSheetByName("user_settings");
  if (!sheet) {
    sheet = ss.insertSheet("user_settings");
    sheet.appendRow(["user_id", "time_format", "is_dark_mode"]);
  }

  const data = sheet.getDataRange().getValues();
  const headers = data.length && data[0] ? data[0].slice() : [];
  const names = Object.keys(values);

  // Grow the header row for anything this save needs that the sheet lacks.
  let added = false;
  names.forEach(function (name) {
    if (headers.indexOf(name) === -1) {
      headers.push(name);
      added = true;
    }
  });
  if (added) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const idCol = headers.indexOf("user_id") !== -1 ? headers.indexOf("user_id") : headers.indexOf("id");
  if (idCol === -1) return false;

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === targetId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    const newRow = headers.map(function (name) {
      return values[name] !== undefined ? values[name] : "";
    });
    newRow[idCol] = targetId;
    sheet.appendRow(newRow);
    return true;
  }

  names.forEach(function (name) {
    const col = headers.indexOf(name);
    if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(values[name]);
  });
  return true;
}

// ============================================================================
// Push devices
//
// One row per DEVICE, because a member with a phone and a computer should get notifications on both.
//
// The original design kept a single `user_settings.fcm_token`, which can only ever hold one. Two
// bugs followed from that, and both looked like the app lying:
//
//   * enabling a second device OVERWROTE the first device's token, so the first silently stopped
//     receiving anything;
//   * "turn off" on the second device cleared the member's token - the FIRST device's - so the
//     device that had never been enabled reported success while breaking the one that worked.
//
// Columns: id, user_id, token, device_label, updated_at
//
// The legacy `user_settings.fcm_token` column is still READ so a device that registered before this
// sheet existed keeps working without anyone re-enabling it, but nothing writes it any more.
// ============================================================================

const PUSH_DEVICE_SHEET = "push_devices";
const PUSH_DEVICE_HEADERS = ["id", "user_id", "token", "device_label", "updated_at"];

// Created on first use rather than requiring a manual step: a missing sheet would mean registrations
// vanish silently, which is the failure mode this whole feature keeps producing.
function pushDeviceSheet(ss) {
  let sheet = ss.getSheetByName(PUSH_DEVICE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PUSH_DEVICE_SHEET);
    sheet.appendRow(PUSH_DEVICE_HEADERS.slice());
  }
  return sheet;
}

function pushDeviceRows(ss) {
  return getSheetData(ss, PUSH_DEVICE_SHEET).filter(function (row) {
    return String(row.token || "").trim() !== "";
  });
}

// userId -> [token], legacy column included.
//
// Built once per send rather than looked up per recipient: the shift-offer fan-out touches every
// approver, and a sheet read per member would be the slowest thing in the request.
function pushTokenIndex(ss) {
  const index = {};

  const add = function (userId, token) {
    const key = String(userId || "").trim();
    const value = String(token || "").trim();
    if (!key || !value) return;
    if (!index[key]) index[key] = [];
    if (index[key].indexOf(value) === -1) index[key].push(value);
  };

  pushDeviceRows(ss).forEach(function (row) {
    add(row.user_id, row.token);
  });

  const settings = userSettingsIndex(ss);
  Object.keys(settings).forEach(function (userId) {
    add(userId, (settings[userId] || {}).fcm_token);
  });

  return index;
}

function pushTokensForUser(ss, userId) {
  return pushTokenIndex(ss)[String(userId === undefined || userId === null ? "" : userId).trim()] || [];
}

// Registers or refreshes one device.
//
// Idempotent by token, so opening the settings card repeatedly cannot accumulate rows. A row that
// already exists is re-pointed at the current member - a shared station tablet can change hands -
// and its label and timestamp are refreshed so the admin list can show what is stale.
function registerPushDevice(ss, userId, token, label) {
  const targetUserId = String(userId === undefined || userId === null ? "" : userId).trim();
  const targetToken = String(token === undefined || token === null ? "" : token).trim();
  if (!targetUserId || !targetToken) return false;

  const sheet = pushDeviceSheet(ss);
  const data = sheet.getDataRange().getValues();
  if (!data.length) return false;

  const headers = data[0].map(String);
  const userCol = headers.indexOf("user_id");
  const tokenCol = headers.indexOf("token");
  const labelCol = headers.indexOf("device_label");
  const stampCol = headers.indexOf("updated_at");
  if (tokenCol === -1 || userCol === -1) return false;

  const stamp = getEasternTimestamp();
  const deviceLabel = String(label || "").trim().slice(0, 80);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][tokenCol]).trim() !== targetToken) continue;

    sheet.getRange(i + 1, userCol + 1).setValue(targetUserId);
    if (labelCol !== -1) sheet.getRange(i + 1, labelCol + 1).setValue(deviceLabel);
    if (stampCol !== -1) sheet.getRange(i + 1, stampCol + 1).setValue(stamp);
    return true;
  }

  const newRow = headers.map(function (header) {
    if (header === "id") return String(newRowId());
    if (header === "user_id") return targetUserId;
    if (header === "token") return targetToken;
    if (header === "device_label") return deviceLabel;
    if (header === "updated_at") return stamp;
    return "";
  });
  sheet.appendRow(newRow);
  return true;
}

// Forgets the given tokens, everywhere they are stored.
//
// `userId` bounds the deletion to one member, which is what stops a dead-token report for one
// account removing a row belonging to another - it cannot happen with real tokens, but the blast
// radius of deleting on a token match is worth bounding.
function deletePushTokens(ss, tokens, userId) {
  const wanted = (Array.isArray(tokens) ? tokens : [tokens])
    .map(function (value) {
      return String(value === undefined || value === null ? "" : value).trim();
    })
    .filter(function (value) {
      return value !== "";
    });
  if (!wanted.length) return 0;

  const wantUser = String(userId === undefined || userId === null ? "" : userId).trim();
  let removed = 0;
  const sheet = ss.getSheetByName(PUSH_DEVICE_SHEET);

  if (sheet) {
    const data = sheet.getDataRange().getValues();
    if (data.length) {
      const headers = data[0].map(String);
      const tokenCol = headers.indexOf("token");
      const userCol = headers.indexOf("user_id");

      if (tokenCol !== -1) {
        // Bottom-up, so deleting a row cannot shift the ones still to be examined.
        for (let i = data.length - 1; i >= 1; i--) {
          if (wanted.indexOf(String(data[i][tokenCol]).trim()) === -1) continue;
          if (wantUser && userCol !== -1 && String(data[i][userCol]).trim() !== wantUser) continue;
          sheet.deleteRow(i + 1);
          removed++;
        }
      }
    }
  }

  // A device registered before this sheet existed lives in the legacy column instead.
  const settings = userSettingsIndex(ss);
  Object.keys(settings).forEach(function (key) {
    if (wantUser && wantUser !== String(key).trim()) return;
    const legacy = String((settings[key] || {}).fcm_token || "").trim();
    if (!legacy || wanted.indexOf(legacy) === -1) return;
    try {
      upsertUserSettingsColumns(ss, key, { fcm_token: "" });
    } catch (err) {
      Logger.log("Could not clear the legacy FCM token for " + key + ": " + err.toString());
    }
  });

  return removed;
}

// How many devices each member has, for the admin status list.
function pushDeviceCountByUser(ss) {
  const index = pushTokenIndex(ss);
  const counts = {};
  Object.keys(index).forEach(function (userId) {
    counts[userId] = index[userId].length;
  });
  return counts;
}


// ============================================================================
// Password hashing (PBKDF2-HMAC-SHA256)
//
// Stored format:  pbkdf2-sha256$<iterations>$<saltBase64>$<digestBase64>
//
// Apps Script has no bcrypt/Argon2 and no native PBKDF2, so key stretching is
// built from Utilities.computeHmacSha256Signature. Every iteration is one
// JS->Java bridge call, which is why the default iteration count is modest -
// run suggestPbkdf2Iterations() to see what this project can actually afford.
// This removes a recoverable secret from the sheet, but it is NOT equivalent
// to a native bcrypt/Argon2 cost factor, so it is paired with the sign-in
// throttling in the next section.
//
// Everything in this section is pure (no sheet, cache or Logger access) so it
// can be exercised outside Apps Script - see scripts/verify-auth-security.mjs.
// ============================================================================

const PASSWORD_HASH_PREFIX = "pbkdf2-sha256";
const PBKDF2_KEY_LENGTH = 32; // SHA-256 digest size, in bytes
const PBKDF2_SALT_LENGTH = 16;
const PBKDF2_ITERATIONS_PROPERTY = "PBKDF2_ITERATIONS";

// Tunables are declared with `var` (not `const`) so the verification harness
// can lower them and still exercise the real code paths quickly.
var PBKDF2_DEFAULT_ITERATIONS = 600;
var PBKDF2_MIN_ITERATIONS = 100;
var PBKDF2_MAX_ITERATIONS = 20000;

// Memoised per execution; each web request is a fresh execution, so this costs
// one property read per request rather than one per hash.
let pbkdf2IterationsMemo = null;

// Iteration count for new hashes: the script property PBKDF2_ITERATIONS when
// set and sane, otherwise the default. The count is recorded inside each hash,
// so raising it later is safe - old hashes verify with their own recorded count
// and are upgraded on the member's next successful sign-in.
function pbkdf2Iterations() {
  if (pbkdf2IterationsMemo !== null) return pbkdf2IterationsMemo;

  var configured = 0;
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(PBKDF2_ITERATIONS_PROPERTY);
    if (raw) configured = parseInt(raw, 10);
  } catch (err) {
    configured = 0; // property store unavailable - fall back to the default
  }

  if (!configured || isNaN(configured) || configured <= 0) {
    pbkdf2IterationsMemo = PBKDF2_DEFAULT_ITERATIONS;
  } else {
    pbkdf2IterationsMemo = Math.max(PBKDF2_MIN_ITERATIONS, Math.min(PBKDF2_MAX_ITERATIONS, configured));
  }
  return pbkdf2IterationsMemo;
}

// Apps Script hands out SIGNED bytes (-128..127) from getBytes()/base64Decode,
// but XOR and base64 of negative numbers is nonsense. All arithmetic here works
// on unsigned 0..255 values, converting back to signed only when handing an
// array back to Utilities, which is the documented Byte[] representation.
function unsignedBytes_(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i] & 0xff);
  return out;
}

function signedBytes_(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i] & 0xff;
    out.push(value > 127 ? value - 256 : value);
  }
  return out;
}

function utf8Bytes_(text) {
  return unsignedBytes_(Utilities.newBlob(String(text == null ? "" : text)).getBytes());
}

// Salt material. Apps Script exposes no Crypto API; Utilities.getUuid() is a
// v4 UUID, so its 122 random bits are the best source available here. If a
// stronger source ever becomes available, this is the only place to change.
function randomSaltBytes_(length) {
  const target = length || PBKDF2_SALT_LENGTH;
  const out = [];
  while (out.length < target) {
    const hex = Utilities.getUuid().replace(/-/g, "");
    if (hex.length === 0) break; // defensive: never spin forever
    for (let i = 0; i + 1 < hex.length && out.length < target; i += 2) {
      out.push(parseInt(hex.substr(i, 2), 16) & 0xff);
    }
  }
  return out;
}

// PBKDF2 (RFC 8018) using HMAC-SHA256 as the PRF. Blocks are generated
// separately, so any key length up to 32 bytes needs exactly one block.
function pbkdf2Sha256_(passwordBytes, saltBytes, iterations, keyLength) {
  const rounds = Math.max(1, parseInt(iterations, 10) || 1);
  const wanted = Math.max(1, parseInt(keyLength, 10) || PBKDF2_KEY_LENGTH);
  const blocks = Math.ceil(wanted / 32);
  const password = signedBytes_(passwordBytes);
  const salt = unsignedBytes_(saltBytes);
  const derived = [];

  for (let block = 1; block <= blocks; block++) {
    const counter = [(block >>> 24) & 0xff, (block >>> 16) & 0xff, (block >>> 8) & 0xff, block & 0xff];

    let u = unsignedBytes_(
      Utilities.computeHmacSha256Signature(signedBytes_(salt.concat(counter)), password)
    );
    const accumulator = u.slice();

    for (let i = 1; i < rounds; i++) {
      u = unsignedBytes_(Utilities.computeHmacSha256Signature(signedBytes_(u), password));
      for (let j = 0; j < accumulator.length; j++) accumulator[j] = (accumulator[j] ^ u[j]) & 0xff;
    }

    for (let k = 0; k < accumulator.length; k++) derived.push(accumulator[k]);
  }

  return derived.slice(0, wanted);
}

function hashPasswordValue(password, iterations) {
  const rounds = iterations || pbkdf2Iterations();
  const salt = randomSaltBytes_(PBKDF2_SALT_LENGTH);
  const digest = pbkdf2Sha256_(utf8Bytes_(password), salt, rounds, PBKDF2_KEY_LENGTH);
  return [
    PASSWORD_HASH_PREFIX,
    String(rounds),
    Utilities.base64Encode(signedBytes_(salt)),
    Utilities.base64Encode(signedBytes_(digest))
  ].join("$");
}

// Returns null for anything that is not a well-formed hash of ours. Callers
// must treat null as "cannot authenticate", never as "compare as plain text" -
// otherwise a corrupted cell would silently become a plain-text password again.
function parsePasswordHashValue(stored) {
  const text = String(stored == null ? "" : stored).trim();
  if (text.indexOf(PASSWORD_HASH_PREFIX + "$") !== 0) return null;

  const parts = text.split("$");
  if (parts.length !== 4) return null;

  const rounds = parseInt(parts[1], 10);
  if (!rounds || isNaN(rounds) || rounds < 1 || rounds > PBKDF2_MAX_ITERATIONS) return null;

  let salt;
  let digest;
  try {
    salt = unsignedBytes_(Utilities.base64Decode(parts[2]));
    digest = unsignedBytes_(Utilities.base64Decode(parts[3]));
  } catch (err) {
    return null;
  }

  if (salt.length !== PBKDF2_SALT_LENGTH) return null;
  if (digest.length !== PBKDF2_KEY_LENGTH) return null;

  return { iterations: rounds, salt: salt, digest: digest };
}

function isHashedPasswordValue(stored) {
  return parsePasswordHashValue(stored) !== null;
}

// Length-independent comparison: no early exit, so response time does not leak
// how many leading bytes of a digest were correct.
function constantTimeEquals_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= (a[i] & 0xff) ^ (b[i] & 0xff);
  return difference === 0;
}

// Single entry point for "does this submitted password match what is stored?".
// The reason is returned so LOGIN can tell a real mismatch apart from a corrupt
// cell, and can see whether the stored value still needs upgrading.
function verifyPasswordValue(stored, submitted, iterations) {
  const text = String(stored == null ? "" : stored);
  const given = String(submitted == null ? "" : submitted);

  if (text.indexOf(PASSWORD_HASH_PREFIX + "$") === 0) {
    const parsed = parsePasswordHashValue(text);
    if (!parsed) return { ok: false, needsRehash: false, reason: "malformed_hash" };

    const digest = pbkdf2Sha256_(utf8Bytes_(given), parsed.salt, parsed.iterations, parsed.digest.length);
    const target = iterations || pbkdf2Iterations();
    return {
      ok: constantTimeEquals_(digest, parsed.digest),
      needsRehash: parsed.iterations < target,
      reason: "hashed"
    };
  }

  // Pre-hashing installs stored the password verbatim. Accept it once so nobody
  // is locked out, and let LOGIN rewrite it as a hash immediately.
  if (text.trim() === "") {
    // A blank password column can never authenticate. Previously an empty cell
    // plus an empty submitted password would sign in as that member.
    return { ok: false, needsRehash: false, reason: "blank" };
  }

  const legacyOk = text.trim() === given.trim();
  return { ok: legacyOk, needsRehash: legacyOk, reason: legacyOk ? "legacy_plaintext" : "mismatch" };
}

// Burns the same key-derivation work as a real account, so response time cannot
// be used to work out whether a username exists. Uses a constant salt.
const PASSWORD_TIMING_SALT_B64 = "AAECAwQFBgcICQoLDA0ODw==";
function dummyPasswordVerification_(submitted, iterations) {
  const salt = unsignedBytes_(Utilities.base64Decode(PASSWORD_TIMING_SALT_B64));
  pbkdf2Sha256_(utf8Bytes_(submitted), salt, iterations || pbkdf2Iterations(), PBKDF2_KEY_LENGTH);
}

// Sign-in throttling and lockout
//
// Counters live in CacheService (the script cache): no sheet reads or writes, so
// a failed attempt stays cheap and the sheet is not the bottleneck under a flood.
// Keys are derived from the submitted username whether or not it exists, so a
// lockout message cannot be used to enumerate valid usernames.
//
// The cache is best-effort - entries can be evicted early - so this throttles
// repeated guessing rather than guaranteeing an exact attempt count. If the cache
// or lock is unavailable the code fails OPEN (allows the attempt) so an outage
// can never lock every member out of the app; those misconfigurations are
// reported by diagnoseAuthSecurity().
// ============================================================================

// Tunables are `var` so the verification harness can drive them down.
var LOGIN_MAX_FAILURES = 5; // failures before the first lock
var LOGIN_LOCK_BASE_SECONDS = 60; // first lock duration
var LOGIN_LOCK_MAX_SECONDS = 900; // ceiling for the escalating lock
var LOGIN_FAILURE_WINDOW_SECONDS = 900; // rolling window for failure counts
var LOGIN_GLOBAL_MAX_FAILURES = 200; // across all usernames in the window
var LOGIN_GLOBAL_WINDOW_SECONDS = 900;

const LOGIN_CACHE_PREFIX = "login:";
const LOGIN_GLOBAL_FAILURE_KEY = LOGIN_CACHE_PREFIX + "fail:_all_";

// Indirection so the harness can move the clock without stubbing globals.
function authNowMs_() {
  return new Date().getTime();
}

function loginFailureKey_(username) {
  return LOGIN_CACHE_PREFIX + "fail:" + String(username == null ? "" : username).trim().toLowerCase();
}

function loginLockKey_(username) {
  return LOGIN_CACHE_PREFIX + "lock:" + String(username == null ? "" : username).trim().toLowerCase();
}

function loginRateLimitMessage(scope, retryAfterSeconds) {
  const minutes = Math.max(1, Math.ceil((retryAfterSeconds || 0) / 60));
  const detail = scope === "global"
    ? "Too many failed sign-in attempts across this site."
    : "Too many failed sign-in attempts.";
  return detail + " Try again in about " + minutes + (minutes === 1 ? " minute." : " minutes.");
}

// Read-only, so a successful sign-in pays two cache lookups and never a lock.
function checkLoginRateLimit(username) {
  let cache;
  try {
    cache = CacheService.getScriptCache();
  } catch (err) {
    return { allowed: true, scope: "none", retryAfterSeconds: 0 }; // fail open
  }

  const now = authNowMs_();

  try {
    const lockRaw = cache.get(loginLockKey_(username));
    if (lockRaw) {
      const until = parseInt(lockRaw, 10);
      if (until && until > now) {
        return {
          allowed: false,
          scope: "account",
          retryAfterSeconds: Math.max(1, Math.ceil((until - now) / 1000))
        };
      }
    }

    const globalCount = parseInt(cache.get(LOGIN_GLOBAL_FAILURE_KEY) || "0", 10);
    if (globalCount >= LOGIN_GLOBAL_MAX_FAILURES) {
      return { allowed: false, scope: "global", retryAfterSeconds: LOGIN_GLOBAL_WINDOW_SECONDS };
    }
  } catch (err) {
    return { allowed: true, scope: "none", retryAfterSeconds: 0 }; // fail open
  }

  return { allowed: true, scope: "account", retryAfterSeconds: 0 };
}

// Records a failed attempt and raises the lock once the threshold is crossed.
// Only this path takes a lock, which keeps the common case fast.
function recordLoginFailure(username) {
  const outcome = { locked: false, retryAfterSeconds: 0, failures: 0 };

  let cache;
  try {
    cache = CacheService.getScriptCache();
  } catch (err) {
    return outcome; // fail open
  }

  let lock = null;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(5000);
  } catch (err) {
    // Could not serialise the increments. Counting is best-effort, so carry on
    // rather than risk blocking a legitimate sign-in attempt.
    lock = null;
  }

  try {
    const now = authNowMs_();
    const failKey = loginFailureKey_(username);
    const failures = parseInt(cache.get(failKey) || "0", 10) + 1;
    cache.put(failKey, String(failures), LOGIN_FAILURE_WINDOW_SECONDS);
    outcome.failures = failures;

    const globalFailures = parseInt(cache.get(LOGIN_GLOBAL_FAILURE_KEY) || "0", 10) + 1;
    cache.put(LOGIN_GLOBAL_FAILURE_KEY, String(globalFailures), LOGIN_GLOBAL_WINDOW_SECONDS);

    if (failures >= LOGIN_MAX_FAILURES) {
      // Escalating backoff: every further LOGIN_MAX_FAILURES doubles the wait,
      // capped at LOGIN_LOCK_MAX_SECONDS.
      const steps = Math.floor((failures - LOGIN_MAX_FAILURES) / LOGIN_MAX_FAILURES);
      const seconds = Math.min(LOGIN_LOCK_MAX_SECONDS, LOGIN_LOCK_BASE_SECONDS * Math.pow(2, steps));
      cache.put(loginLockKey_(username), String(now + seconds * 1000), seconds);
      outcome.locked = true;
      outcome.retryAfterSeconds = seconds;
    }
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (err) {
        // releasing is best-effort
      }
    }
  }

  return outcome;
}

function recordLoginSuccess(username) {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(loginFailureKey_(username));
    cache.remove(loginLockKey_(username));
  } catch (err) {
    // non-fatal: a stale counter simply expires on its own
  }
  // The global counter is deliberately left alone. Clearing it here would let an
  // attacker interleave one valid sign-in to reset their own throttle.
}

// Replaces a user's stored password with a hash. Used to upgrade legacy
// plain-text rows on a successful sign-in, and by migrateLegacyPasswords().
function storePasswordHash(ss, userId, plainPassword) {
  const sheet = ss.getSheetByName("users");
  if (!sheet) return false;

  const values = sheet.getDataRange().getValues();
  if (!values.length) return false;

  const headers = values[0];
  const idIndex = headers.indexOf("id");
  const passIndex = headers.indexOf("password");
  if (idIndex === -1 || passIndex === -1) return false;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(userId)) {
      sheet.getRange(i + 1, passIndex + 1).setValue(hashPasswordValue(plainPassword));
      return true;
    }
  }
  return false;
}

// ============================================================================
// ID MIGRATION: sequential ids -> UUIDs
// ============================================================================
//
// Run once from the Apps Script editor, after deploying the version of Code.gs that allocates ids with
// newRowId(). The editor's Run button cannot pass arguments, so the two halves are two functions: pick one
// in the toolbar's function dropdown and press Run. In this order.
//
//     checkIdMigration      the dry run: reports what it WOULD do, writes nothing
//     applyIdMigration      the real thing
//
// Why it exists: ids used to be "the last row's id plus one", so deleting the highest-id row freed that id and
// the next created row inherited it. A `schedule_offers.schedule_id` still on file would then point at a
// DIFFERENT shift. See newRowId for the full note.
//
// It is deliberately a script rather than a manual pass. A mistyped id in `schedule.user_id` does not error -
// it silently puts somebody else on a shift - and the id columns are only half the job: every `*_id` column,
// plus `approved_by`, `declined_by` and `author_user_id`, references an id somewhere else too. This walks them
// all, refuses to guess, and records the old->new mapping so the move can be audited, resumed or reversed.

// Where the mapping is recorded. Also what makes a re-run safe: a half-finished migration is completed from the
// ids already handed out, rather than the remaining rows getting fresh ones and orphaning the references.
const ID_MIGRATION_SHEET = "id_migration";

// The sheets whose `id` column is a record id, and therefore gets a UUID.
//
// `system_log` is deliberately absent: nothing references a log row (it is appended to and read, never joined,
// edited or deleted by id), so it keeps compact numeric ids a human can scan. Add a sheet here when a new one is
// added - the function reports any sheet in this list with no `id` column, and any reference column it cannot
// resolve, rather than skipping them silently.
const ID_RECORD_SHEETS = [
  "users",
  "roles",
  "ranks",
  "shifts",
  "assignments",
  "apparatus",
  "schedule_templates",
  "schedule",
  "schedule_offers",
  "availability",
  "announcements",
  "events",
  "training",
  "training_signatures",
  "timeclock",
  "push_devices"
];

// Which sheet a reference column points at.
//
// Written out rather than derived by pluralising the prefix: "schedule_id" -> "schedule" and
// "apparatus_id" -> "apparatus" are not plurals, and a guess that resolved to the wrong sheet would rewrite a
// column with another sheet's ids - the one failure this migration must not have.
const ID_REFERENCE_TARGETS = {
  user_id: "users",
  role_id: "roles",
  rank_id: "ranks",
  assignment_id: "assignments",
  apparatus_id: "apparatus",
  schedule_template_id: "schedule_templates",
  schedule_id: "schedule",
  training_id: "training",
  // Columns that reference a member without saying "_id".
  approved_by: "users",
  declined_by: "users",
  author_user_id: "users"
};

// Every sheet scanned for REFERENCE columns: the record sheets, plus the two that hold a member reference
// without being records themselves.
//
// This distinction is the first thing the verifier caught: `system_log` and `user_settings` were being skipped
// entirely because their own `id` is not migrated, which left their `user_id` pointing at ids that no longer
// existed. A sheet can be a reference SOURCE without being a record.
const ID_REFERENCE_SHEETS = ID_RECORD_SHEETS.concat(["system_log", "user_settings"]);

// A UUID, as Utilities.getUuid() formats one. Used to recognise a row that has already been migrated, which is
// what makes this function safe to run twice.
function isUuidValue(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

// The recorded old->new map, as { sheetName: { oldId: newId } }.
function readIdMigrationMap(ss) {
  const map = {};
  const sheet = ss.getSheetByName(ID_MIGRATION_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return map;

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (h) { return String(h || "").trim(); });
  const sheetCol = headers.indexOf("sheet_name");
  const oldCol = headers.indexOf("old_id");
  const newCol = headers.indexOf("new_id");
  if (sheetCol === -1 || oldCol === -1 || newCol === -1) return map;

  for (let i = 1; i < values.length; i++) {
    const name = String(values[i][sheetCol] || "").trim();
    const oldId = String(values[i][oldCol] || "").trim();
    const newId = String(values[i][newCol] || "").trim();
    if (!name || !oldId || !newId) continue;
    if (!map[name]) map[name] = {};
    if (!map[name][oldId]) map[name][oldId] = newId;
  }
  return map;
}

// What the migration WOULD do, deciding everything without writing anything.
//
// A row that is already a UUID keeps its id and maps to itself (so references to it still resolve), a row with
// no id is left alone, and a reference that cannot be resolved is REPORTED rather than blanked - a dangling
// reference is a fact to look at, not something to erase.
function planIdMigration(ss) {
  const recorded = readIdMigrationMap(ss);
  // `newPairs` is what this RUN decided, as opposed to every pair it knows about. Only these are recorded:
  // writing the whole map would re-append every pair on a second run and make "nothing to do" look like work.
  //
  // `legacyValues` are references that resolve to NOTHING - a deleted member, a free-text entry, `Unknown`.
  // They do not block the run (see planIdReferences); they are listed so the operator knows what was left.
  // `resolvedNames` are references that were a username rather than an id and were matched to a member.
  const plan = { sheets: [], map: {}, references: [], problems: [], newPairs: [], legacyValues: [], resolvedNames: [] };

  ID_RECORD_SHEETS.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return; // a sheet this deployment does not have

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return;

    const headers = values[0].map(function (h) { return String(h || "").trim(); });
    const idCol = headers.indexOf("id");
    if (idCol === -1) {
      // Listed as a record sheet but without an id column: a real problem, because the next write would put a
      // UUID in whatever column happens to come first.
      plan.problems.push(name + ": listed as a record sheet but has no id column");
      return;
    }

    const map = Object.assign({}, recorded[name] || {});
    const changes = [];
    const seen = {};

    for (let i = 1; i < values.length; i++) {
      const id = String(values[i][idCol] === undefined || values[i][idCol] === null ? "" : values[i][idCol]).trim();
      if (!id) {
        plan.problems.push(name + " row " + (i + 1) + ": no id");
        continue;
      }
      // Two rows sharing an id make the mapping ambiguous: whatever the references say, half of them would end
      // up pointing at the wrong row. Refused rather than guessed.
      if (seen[id]) plan.problems.push(name + ": id " + id + " appears more than once");
      seen[id] = true;

      if (isUuidValue(id)) {
        if (!map[id]) map[id] = id;
        continue;
      }
      if (!map[id]) {
        map[id] = String(newRowId());
        plan.newPairs.push({ sheet: name, oldId: id, newId: map[id] });
      }
      changes.push({ rowIndex: i + 1, oldId: id, newId: map[id] });
    }

    plan.map[name] = map;
    if (changes.length) {
      plan.sheets.push({ name: name, sheet: sheet, headers: headers, idCol: idCol, changes: changes });
    }
  });

  return planIdReferences(ss, plan, recorded);
}

// Resolves a reference that is not an id at all but a USERNAME.
//
// Why this exists: the `system_log` sheet holds rows from an earlier version of the app that recorded the
// member's user_name in `user_id`. They are not dangling ids - they name a member - so the right answer is to
// resolve them to that member and carry them through, not to refuse the whole migration over history that
// cannot be rewritten by guessing. `Unknown`, and names of members who have since been deleted, resolve to
// nothing and are reported as values left as they are.
function userNameToIdIndex(ss) {
  const index = {};
  getSheetData(ss, "users").forEach(function (user) {
    // Trimmed and case-folded, because a legacy log holds both "Crave" and "crave" for the same person.
    const name = String(user && user.user_name !== undefined && user.user_name !== null ? user.user_name : "").trim().toLowerCase();
    const id = String(user && user.id !== undefined && user.id !== null ? user.id : "").trim();
    if (!name || !id || index[name]) return;
    // The display name rides along so the report can say WHO a legacy value was, not which id it was.
    index[name] = { id: id, label: String(user.name || "").trim() || name };
  });
  return index;
}

// References, resolved against the maps worked out above. Walked over the REFERENCE sheets (which include the
// two that only hold references) rather than the record sheets.
function planIdReferences(ss, plan, recorded) {
  const userNameIndex = userNameToIdIndex(ss);

  ID_REFERENCE_SHEETS.forEach(function (name) {
    
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return;
    const headers = values[0].map(function (h) { return String(h || "").trim(); });

    headers.forEach(function (header, col) {
      const target = ID_REFERENCE_TARGETS[header];
      if (!target) return;
      const targetMap = plan.map[target] || recorded[target] || {};

      const changes = [];
      for (let i = 1; i < values.length; i++) {
        const value = String(values[i][col] === undefined || values[i][col] === null ? "" : values[i][col]).trim();
        if (!value) continue;

        let mapped = targetMap[value];
        let resolvedFrom = "";

        // A username in a user reference: resolve it to the member, then to their new id.
        if (!mapped && target === "users") {
          const match = userNameIndex[value.toLowerCase()];
          if (match && targetMap[match.id]) {
            mapped = targetMap[match.id];
            resolvedFrom = match.label;
          }
        }

        if (!mapped) {
          // NOT a refusal. A reference that resolves to nothing is a fact about the station's data - a deleted
          // member, a legacy free-text value, a hand-typed entry - and the migration cannot invent the row it
          // meant. It is left exactly as it is and listed in the report, so a correct migration is not blocked
          // by history nobody can reconstruct. What IS refused is AMBIGUITY: a duplicate id, or a row with no id.
          plan.legacyValues.push(name + "." + header + " row " + (i + 1) + ': "' + value + '"');
          continue;
        }

        if (resolvedFrom) {
          plan.resolvedNames.push(name + "." + header + " row " + (i + 1) + ': "' + value + '" -> ' + resolvedFrom);
        }
        if (mapped !== value) changes.push({ rowIndex: i + 1, col: col + 1, from: value, to: mapped });
      }
      if (changes.length) {
        plan.references.push({ name: name, sheet: sheet, header: header, changes: changes });
      }
    });
  });

  return plan;
}
// Writes a new id into each changed row.
//
// NOT one setValues over the whole span: the rows needing an id need not be adjacent - a partially migrated
// sheet has UUIDs and sequential ids side by side, and a new row created by the current code can sit between
// two old ones. Writing a block from the first change would stamp every row in between with the wrong id, so
// consecutive rows are grouped into runs and each run gets its own write.
function writeIdColumn(sheet, idCol, changes) {
  let runStart = 0;
  for (let i = 1; i <= changes.length; i++) {
    const contiguous = i < changes.length && changes[i].rowIndex === changes[i - 1].rowIndex + 1;
    if (contiguous) continue;

    const run = changes.slice(runStart, i);
    const values = run.map(function (change) { return [change.newId]; });
    sheet.getRange(run[0].rowIndex, idCol + 1, values.length, 1).setValues(values);
    runStart = i;
  }
  return changes.length;
}

// Records the old->new pairs. Only pairs that CHANGED are written, so a re-run appends nothing - which is what
// makes this sheet a durable record of the migration rather than a log of attempts.
function writeIdMigrationMap(ss, plan) {
  // Only the pairs THIS run decided. Writing the whole map (which includes everything recorded on earlier runs)
  // would append every pair again on a second run, so a no-op would look like work and the sheet would grow
  // without bound across repeated runs.
  const stamp = getEasternTimestamp();
  const rows = (plan.newPairs || []).map(function (pair) {
    return [pair.sheet, pair.oldId, pair.newId, stamp];
  });
  if (!rows.length) return 0;

  let sheet = ss.getSheetByName(ID_MIGRATION_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ID_MIGRATION_SHEET);
    sheet.appendRow(["sheet_name", "old_id", "new_id", "migrated_at"]);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(["sheet_name", "old_id", "new_id", "migrated_at"]);
  }

  const width = Math.max(sheet.getLastColumn(), 4);
  const padded = rows.map(function (row) {
    const line = row.slice();
    while (line.length < width) line.push("");
    return line;
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, padded.length, width).setValues(padded);
  return padded.length;
}

// Signs everybody out.
//
// Session records carry the member's id (`fc_auth_*`) and so do the revocation epochs (`fc_epoch_*`), and those
// ids are being replaced. Bumping each epoch makes every live record stale, and the sweep then deletes them, so
// the next request signs in against the new ids instead of half-working with the old ones.
function resetSessionsForIdMigration(ss) {
  const props = PropertiesService.getScriptProperties();
  const users = getSheetData(ss, "users");

  users.forEach(function (user) {
    const id = String(user && user.id !== undefined && user.id !== null ? user.id : "").trim();
    if (id) bumpSessionEpoch(id);
  });

  let cleared = 0;
  props.getKeys().forEach(function (key) {
    if (key.indexOf(SESSION_PROPERTY_PREFIX) !== 0) return;
    const record = parseSessionRecord(props.getProperty(key));
    if (String(record.epoch || "") !== sessionEpochFor(record.userId)) {
      props.deleteProperty(key);
      cleared++;
    }
  });

  return { usersBumped: users.length, sessionsCleared: cleared };
}


// The migration itself. See the section note above for what it does and why.
//
// `dryRun` defaults to TRUE: a call with no arguments reports what it would do and writes NOTHING, so a typo
// cannot rewrite the station's data. The two zero-argument runners at the bottom of this section are what the
// Apps Script editor's function dropdown actually calls - it cannot pass arguments.
function migrateIdsToUuids(options) {
  const opts = options || {};
  const dryRun = opts.dryRun !== false;

  const lock = LockService.getScriptLock();
  const gate = acquireWriteLock(lock, "MIGRATE_IDS");

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const plan = planIdMigration(ss);

    const summary = {
      ok: plan.problems.length === 0,
      dryRun: dryRun,
      sheets: plan.sheets.map(function (entry) {
        return { sheet: entry.name, idsToChange: entry.changes.length };
      }),
      references: plan.references.map(function (entry) {
        return { sheet: entry.name, column: entry.header, valuesToChange: entry.changes.length };
      }),
      problems: plan.problems.slice(0, 50),
      problemCount: plan.problems.length,
      // References that were a username and were matched to a member, and those that matched nothing at all.
      resolvedNames: plan.resolvedNames.slice(0, 20),
      resolvedNameCount: plan.resolvedNames.length,
      legacyValues: plan.legacyValues.slice(0, 20),
      legacyValueCount: plan.legacyValues.length
    };

    // Refuses to write while anything is AMBIGUOUS: a duplicate id, a row with no id, or a record sheet without
    // an id column - each of which would put a reference on the wrong row. A reference that resolves to nothing
    // is NOT in this list: it is history the migration cannot reconstruct (a deleted member, a legacy free-text
    // value), it is reported as left exactly as it is, and blocking on it would stop a correct migration for a
    // reason nobody can act on.
    if (plan.problems.length) {
      summary.message = "Nothing was changed. Resolve the " + plan.problems.length + " problem(s) listed first.";
      reportIdMigration(summary);
      return summary;
    }

    if (dryRun) {
      summary.message = "Dry run: nothing was written. Call migrateIdsToUuids({ dryRun: false }) to apply it.";
      reportIdMigration(summary);
      return summary;
    }

    // The lock is only needed for the real thing; a dry run writes nothing, so it cannot race a save.
    if (!gate.ok) {
      summary.ok = false;
      summary.message = "The station portal is busy saving something else. Run the migration again in a moment.";
      reportIdMigration(summary);
      return summary;
    }

    // 1. The mapping FIRST, so a run interrupted part-way can be COMPLETED by re-running: the recorded pairs are
    //    reused instead of fresh UUIDs being handed out for rows that were already migrated.
    summary.mappingRowsWritten = writeIdMigrationMap(ss, plan);

    // 2. The ids, grouped into consecutive runs so a partially migrated sheet cannot be mangled.
    plan.sheets.forEach(function (entry) {
      writeIdColumn(entry.sheet, entry.idCol, entry.changes);
    });

    // 3. Every reference, cell by cell (they are scattered across columns and rows).
    plan.references.forEach(function (entry) {
      entry.changes.forEach(function (change) {
        entry.sheet.getRange(change.rowIndex, change.col).setValue(change.to);
      });
    });

    // 4. Signs everybody out: their sessions carry the ids that just changed.
    summary.sessions = resetSessionsForIdMigration(ss);
    summary.message = "Migration applied. Everyone has been signed out and will sign in again on their next action.";
    reportIdMigration(summary);
    return summary;
  } finally {
    if (gate.ok && gate.took) lock.releaseLock();
  }
}

// The two things you actually select in the Apps Script editor.
//
// The Run button passes no arguments, so a single function with an options object is not runnable from the
// toolbar - which is how this section read before somebody pointed out that "run it from the editor" left no
// way to run the applying half. Two zero-argument runners, in the order they should be used, matching the
// convention of migrateLegacyPasswords() and diagnoseAuthSecurity() below.

// Step 1. Reports what the migration would change and writes nothing.
function checkIdMigration() {
  return migrateIdsToUuids({ dryRun: true });
}

// Step 2. Applies it. Asks for a free script lock, rewrites the ids and every reference to them, records the
// mapping, and signs everybody out.
function applyIdMigration() {
  return migrateIdsToUuids({ dryRun: false });
}

// The report, in the Apps Script editor's log. Also returned, so a caller can inspect the summary object.
function reportIdMigration(summary) {
  const total = function (rows, key) {
    return rows.reduce(function (sum, entry) { return sum + entry[key]; }, 0);
  };
  const lines = [];
  lines.push("ID migration " + (summary.dryRun ? "(DRY RUN - nothing written)" : "(APPLIED)"));
  lines.push("  ids to change: " + total(summary.sheets, "idsToChange") + " across " + summary.sheets.length + " sheet(s)");
  summary.sheets.forEach(function (entry) { lines.push("    " + entry.sheet + ": " + entry.idsToChange); });
  lines.push("  reference values to change: " + total(summary.references, "valuesToChange") +
    " across " + summary.references.length + " column(s)");
  summary.references.forEach(function (entry) {
    lines.push("    " + entry.sheet + "." + entry.column + ": " + entry.valuesToChange);
  });
  if (summary.problemCount) {
    lines.push("  PROBLEMS (" + summary.problemCount + ", first 50) - these MUST be resolved, nothing was written:");
    summary.problems.forEach(function (problem) { lines.push("    " + problem); });
  }
  if (summary.resolvedNameCount) {
    // A username in an id column, matched to the member it names and carried through to their new id.
    lines.push("  " + summary.resolvedNameCount + " reference(s) held a USERNAME rather than an id (first 20):");
    summary.resolvedNames.forEach(function (entry) { lines.push("    " + entry); });
  }
  if (summary.legacyValueCount) {
    lines.push("  " + summary.legacyValueCount + " reference(s) name nothing and are LEFT AS THEY ARE (first 20):");
    summary.legacyValues.forEach(function (entry) { lines.push("    " + entry); });
    lines.push("    (a deleted member, or a value that was never an id - the migration cannot invent the row)");
  }
  if (summary.mappingRowsWritten !== undefined) lines.push("  mapping rows written: " + summary.mappingRowsWritten);
  if (summary.sessions) {
    lines.push("  sessions cleared: " + summary.sessions.sessionsCleared +
      " (members re-signed-out: " + summary.sessions.usersBumped + ")");
  }
  if (summary.message) lines.push("  " + summary.message);

  const text = lines.join("\n");
  Logger.log(text);
  console.log(text);
  return text;
}








// Auth security tooling - run these from the Apps Script editor, not the web app
// ============================================================================

// Hashes every plain-text password in the users sheet, in place. Safe to re-run:
// rows already holding a hash are left untouched. Members are not locked out
// either way, because LOGIN also upgrades a legacy row on the first successful
// sign-in - this simply closes the window immediately for everyone, including
// accounts that may never sign in again.
function migrateLegacyPasswords() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("users");
  if (!sheet) {
    const missing = "[FAIL] no sheet named 'users'";
    Logger.log(missing);
    return missing;
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    const empty = "[info] users sheet has no data rows";
    Logger.log(empty);
    return empty;
  }

  const passIndex = values[0].indexOf("password");
  if (passIndex === -1) {
    const noColumn = "[FAIL] no 'password' column on the users sheet";
    Logger.log(noColumn);
    return noColumn;
  }

  // One read and at most one write for the whole column, rather than a call per
  // member - Apps Script cell writes are individually slow.
  const column = sheet.getRange(2, passIndex + 1, values.length - 1, 1).getValues();
  let migrated = 0;
  let already = 0;
  let blank = 0;

  for (let i = 0; i < column.length; i++) {
    const stored = String(column[i][0] == null ? "" : column[i][0]);
    if (stored.trim() === "") {
      blank++;
      continue;
    }
    if (isHashedPasswordValue(stored)) {
      already++;
      continue;
    }
    column[i][0] = hashPasswordValue(stored);
    migrated++;
  }

  if (migrated > 0) sheet.getRange(2, passIndex + 1, column.length, 1).setValues(column);

  const report = [
    migrated > 0 ? "[ok]   migration complete" : "[ok]   nothing to migrate",
    "[info] iterations used: " + pbkdf2Iterations(),
    "[info] migrated from plain text: " + migrated,
    "[info] already hashed: " + already,
    "[info] blank password cells: " + blank
  ];
  if (blank > 0) {
    report.push("[warn] blank password cells can never sign in - set a password for those members in Administration > Users");
  }

  const text = report.join("\n");
  Logger.log(text);
  return text;
}

// Milliseconds for one password verification at the configured iteration count.
// Run this before raising PBKDF2_ITERATIONS so the extra sign-in wait is a
// deliberate trade-off rather than a surprise.
function benchmarkPasswordHashing(samples) {
  const runs = Math.max(1, parseInt(samples, 10) || 3);
  const rounds = pbkdf2Iterations();
  const password = utf8Bytes_("benchmark-password");
  const salt = randomSaltBytes_(PBKDF2_SALT_LENGTH);

  const started = authNowMs_();
  for (let i = 0; i < runs; i++) pbkdf2Sha256_(password, salt, rounds, PBKDF2_KEY_LENGTH);
  const perRun = (authNowMs_() - started) / runs;

  Logger.log("[info] " + PASSWORD_HASH_PREFIX + " x" + rounds + ": " + perRun.toFixed(0) +
    " ms per password verification (" + runs + " samples)");
  return perRun;
}

// Picks an iteration count that fills the given time budget (default 250 ms) on
// this project, and prints how to apply it. Apps Script runs on shared
// infrastructure, so timings vary - treat the result as a starting point.
function suggestPbkdf2Iterations(targetMs) {
  const target = Math.max(50, parseInt(targetMs, 10) || 250);
  const sampleRounds = 100;
  const password = utf8Bytes_("benchmark-password");
  const salt = randomSaltBytes_(PBKDF2_SALT_LENGTH);

  pbkdf2Sha256_(password, salt, 10, PBKDF2_KEY_LENGTH); // warm up the bridge
  const started = authNowMs_();
  pbkdf2Sha256_(password, salt, sampleRounds, PBKDF2_KEY_LENGTH);
  const perIteration = (authNowMs_() - started) / sampleRounds;

  const suggested = perIteration > 0 ? Math.floor(target / perIteration) : PBKDF2_DEFAULT_ITERATIONS;
  const clamped = Math.max(PBKDF2_MIN_ITERATIONS, Math.min(PBKDF2_MAX_ITERATIONS, suggested));

  const report = [
    "[info] measured " + perIteration.toFixed(2) + " ms per iteration on this project",
    "[info] target budget: " + target + " ms per sign-in",
    "[info] suggested " + PBKDF2_ITERATIONS_PROPERTY + " = " + clamped,
    "[info] current value: " + pbkdf2Iterations(),
    "[info] apply it in Project Settings > Script Properties (existing hashes keep",
    "[info] their own recorded count and are upgraded as members sign in)"
  ];

  const text = report.join("\n");
  Logger.log(text);
  return clamped;
}

// Reports the state of password hashing and sign-in throttling, including how
// many rows are still stored in plain text. Run after deploying the backend.
function diagnoseAuthSecurity() {
  const report = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  report.push("[info] hashing: " + PASSWORD_HASH_PREFIX + " (built on Utilities; Apps Script has no bcrypt/Argon2)");
  report.push("[info] iterations: " + pbkdf2Iterations() +
    " (script property " + PBKDF2_ITERATIONS_PROPERTY + " overrides the default " + PBKDF2_DEFAULT_ITERATIONS + ")");

  try {
    const perRun = benchmarkPasswordHashing(2);
    report.push((perRun <= 750 ? "[ok]   " : "[warn] ") + "cost: " + perRun.toFixed(0) +
      " ms per verification, on top of the existing sign-in work");
    if (perRun > 750) {
      report.push("[warn] that is a long sign-in; consider lowering " + PBKDF2_ITERATIONS_PROPERTY);
    }
  } catch (err) {
    report.push("[FAIL] benchmark: " + err.toString());
  }

  try {
    const sheet = ss.getSheetByName("users");
    if (!sheet) {
      report.push("[FAIL] users sheet: not found");
    } else {
      const values = sheet.getDataRange().getValues();
      const passIndex = values.length ? values[0].indexOf("password") : -1;
      if (passIndex === -1) {
        report.push("[FAIL] users sheet: no 'password' column");
      } else {
        let hashed = 0;
        let plain = 0;
        let blank = 0;
        for (let i = 1; i < values.length; i++) {
          const stored = String(values[i][passIndex] == null ? "" : values[i][passIndex]);
          if (stored.trim() === "") blank++;
          else if (isHashedPasswordValue(stored)) hashed++;
          else plain++;
        }
        report.push("[info] users: " + (values.length - 1) + " rows - " + hashed + " hashed, " +
          plain + " plain text, " + blank + " blank");
        report.push(plain === 0
          ? "[ok]   no plain-text passwords remain in the users sheet"
          : "[warn] " + plain + " plain-text password(s) remain - run migrateLegacyPasswords()");
        if (blank > 0) {
          report.push("[warn] " + blank + " blank password cell(s) can never sign in");
        }
      }
    }
  } catch (err) {
    report.push("[FAIL] users sheet: " + err.toString());
  }

  try {
    const cache = CacheService.getScriptCache();
    cache.put("auth:diagnostic", "1", 30);
    const echoed = cache.get("auth:diagnostic");
    cache.remove("auth:diagnostic");
    report.push(echoed === "1"
      ? "[ok]   CacheService reachable - rate limiting is active"
      : "[FAIL] CacheService did not return the probe value - rate limiting is failing open");
  } catch (err) {
    report.push("[FAIL] CacheService unavailable, so rate limiting fails open: " + err.toString());
  }

  try {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(1000)) {
      lock.releaseLock();
      report.push("[ok]   LockService reachable");
    } else {
      report.push("[warn] LockService busy - failure counts may undercount under load");
    }
  } catch (err) {
    report.push("[FAIL] LockService unavailable: " + err.toString());
  }

  report.push("[info] throttle: " + LOGIN_MAX_FAILURES + " failures -> " + LOGIN_LOCK_BASE_SECONDS +
    "s lock, doubling to a " + LOGIN_LOCK_MAX_SECONDS + "s cap; global cap " +
    LOGIN_GLOBAL_MAX_FAILURES + " failures per " + Math.round(LOGIN_GLOBAL_WINDOW_SECONDS / 60) + " min");

  const text = report.join("\n");
  Logger.log(text);
  return text;
}

// One-shot diagnostic - run this from the Apps Script editor, not the web app.
//
// Running any function in the editor is what raises the OAuth consent dialog,
// so this doubles as the "grant UrlFetchApp permission" step. It then probes
// the network, the FCM configuration and the service account, and prints
// exactly what is still missing. Select diagnoseFcmSetup in the editor's
// function dropdown and press Run.
// ============================================================================
function diagnoseFcmSetup() {
  const report = [];

  // 1. Can we make an external request at all? This is the call that raises the
  //    consent dialog when the script predates the UrlFetchApp code.
  try {
    const probe = UrlFetchApp.fetch("https://www.googleapis.com/oauth2/v3/certs", {
      method: "get",
      muteHttpExceptions: true
    });
    report.push("[ok]   external requests: granted " + FCM_SCOPE_HINT + " (HTTP " + probe.getResponseCode() + ")");
  } catch (err) {
    report.push("[FAIL] external requests: " + err.toString());
    report.push("       Grant it with ONE of these:");
    report.push("       A. Re-run this function and accept the consent prompt. If no prompt");
    report.push("          appears the old token is still valid, so revoke access first:");
    report.push("          https://myaccount.google.com/permissions -> remove this project,");
    report.push("          then run this function again.");
    report.push("       B. Or pin the scopes explicitly. Project Settings -> tick 'Show");
    report.push("          appsscript.json manifest file in editor', then add:");
    report.push("          \"oauthScopes\": " + JSON.stringify(FCM_REQUIRED_SCOPES));
    report.push("          These two are every scope this script needs. An explicit list");
    report.push("          disables automatic detection, so it must stay complete.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let config;
  try {
    config = fcmConfig(ss);
  } catch (err) {
    report.push("[FAIL] configuration: could not read system_settings - " + err.toString());
    const text = report.join("\n");
    Logger.log(text);
    return text;
  }

  // 2. Is the FCM configuration complete?
  const keyLines = config.privateKey ? config.privateKey.split("\n").length : 0;
  report.push("[info] project id: " + (config.projectId || "(missing)"));
  report.push("[info] service account: " + (config.clientEmail || "(missing)"));
  report.push("[info] private key: " + (config.privateKey ? "present (" + keyLines + " lines)" : "(missing)"));
  report.push("[info] web config (browser): " + (String(config.settings.fcm_web_config || "").trim() ? "present" : "(missing)"));
  report.push("[info] vapid public key (browser): " + (config.settings.fcm_vapid_public_key ? "present" : "(missing)"));
  report.push(config.ready
    ? "[ok]   configuration: complete"
    : "[FAIL] configuration: incomplete - fill in Administration > System > Notifications");

  // 3. Can we mint a token for the service account?
  if (config.ready) {
    try {
      const token = fcmAccessToken(config);
      report.push("[ok]   service account token: obtained (length " + token.length + ")");
    } catch (err) {
      report.push("[FAIL] service account token: " + err.toString());
      report.push("       " + fcmFailureAdvice(classifyFcmFailure(err)));
    }
  }

  // 4. Who can actually receive a push?
  try {
    const users = getSheetData(ss, "users");
    const index = userSettingsIndex(ss);
    const registered = users.filter(function (u) {
      const row = index[String(u.id).trim()];
      return !!(row && String(row.fcm_token || "").trim() !== "");
    });
    report.push("[info] devices registered: " + registered.length + " of " + users.length + " members");
    if (!registered.length) {
      report.push("       Nobody has pressed Enable in User Settings yet, so there is nothing to send to.");
    }
  } catch (err) {
    report.push("[FAIL] registered devices: " + err.toString());
  }

  const text = report.join("\n");
  Logger.log(text);
  return text;
}

function logSystemEvent(ss, userId, action, details) {
  try {
    const logSheet = ss.getSheetByName("system_log");
    if (!logSheet) return;

    const nextId = nextLogRowId(logSheet);
    const timestamp = getEasternTimestamp();

    logSheet.appendRow([
      nextId,
      timestamp,
      userId || "",
      action,
      details || ""
    ]);
  } catch (err) {
    Logger.log("Failed to write to system_log: " + err.toString());
  }
}

// ============================================================================
// SYSTEM LOG (reading it)
// ============================================================================
//
// The log only grows, so nothing here returns the whole thing. Filtering, sorting and paging all
// happen BEFORE the response is built, and only one page of rows is sent - which is what keeps
// opening the tab cheap however large the sheet gets.
//
// One honest caveat: `getSheetData` still reads the sheet, so the server's own cost grows with the
// log. That is inherent to Sheets, and paging by reading only part of the range would make the row
// count and the filter facets wrong. What this design buys is a small payload and a client that
// never holds more than one page.

const LOG_PAGE_SIZE_DEFAULT = 20;
const LOG_PAGE_SIZE_MAX = 100;

// Bumped when the shape of this feature's request or response changes. The client compares it and says
// so when the deployed script is older, because a rename like `action_filter` is invisible otherwise:
// an old backend reads the RPC name as the filter and returns an empty page, which looks exactly like
// "the log is empty" rather than "you have not redeployed".
const SYSTEM_LOG_API_VERSION = 2;

// Whitelisted, because sorting happens here: an unrecognised value falls back to the default rather
// than arriving as "unsorted", which would silently render the sheet's own row order.
const LOG_SORTS = ["timestamp_desc", "timestamp_asc", "action_asc", "member_asc"];
const LOG_SORT_DEFAULT = "timestamp_desc";

function logCellText(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

// A log cell is not always text.
//
// logSystemEvent writes "yyyy-MM-dd HH:mm:ss", but when the timestamp COLUMN is formatted as a date,
// Sheets stores that string as a date value and getValues() hands back a Date. String(Date) is
// "Wed Sep 24 2026 22:15:00 GMT-0400 (Eastern Daylight Time)", which starts with the WEEKDAY: the
// date key below then fails to parse, every row is treated as undated, and the alphabetical fallback
// groups every Wednesday together. Normalizing to the canonical station-time text fixes the sort and
// the display in one place.
function logTimestampText(value) {
  if (value === undefined || value === null || value === "") return "";
  if (value instanceof Date) {
    return Utilities.formatDate(value, "America/New_York", "yyyy-MM-dd HH:mm:ss");
  }

  const raw = String(value).trim();
  // Already the text logSystemEvent writes (allowing the "T" an ISO string carries).
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)) return raw.replace("T", " ");

  // Anything else a Date can read - including an ISO string with a zone - is converted to station
  // time, so two rows are compared as instants rather than as whatever text a sheet happened to hold.
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, "America/New_York", "yyyy-MM-dd HH:mm:ss");
  }
  return raw;
}

// The sortable form: "yyyy-MM-dd HH:mm:ss", or "" when the value is not a date at all. Sorting on this
// rather than on the raw text is what makes a column holding mixed shapes behave.
function logSortKey(timestampText) {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?/.exec(String(timestampText || ""));
  if (!match) return "";
  return match[1] + " " + match[2] + ":" + (match[3] || "00");
}

function normalizeLogEntry(row) {
  const source = row || {};
  const timestamp = logTimestampText(source.timestamp);
  const sortKey = logSortKey(timestamp);
  return {
    id: logCellText(source.id),
    timestamp: timestamp,
    // The date half of the sort key, and validated: a hand-edited cell holding "nonsense" must not
    // yield a ten-character key that sorts as if it were a very late date. An unreadable timestamp is
    // treated as undated, which sorts last and cannot satisfy a date range.
    date_key: sortKey ? sortKey.slice(0, 10) : "",
    // The full instant, so ordering does not depend on the shape of the cell it came from.
    sort_key: sortKey,
    user_id: logCellText(source.user_id),
    action: logCellText(source.action),
    details: logCellText(source.details),
  };
}

// A log entry against the filter set. Blank filters are ignored, so an unset filter is not "match
// nothing" - the one mistake that would make an empty table look like an empty log.
function logEntryMatches(entry, filters) {
  if (!entry) return false;

  if (filters.from || filters.to) {
    if (!entry.date_key) return false;
    if (filters.from && entry.date_key < filters.from) return false;
    if (filters.to && entry.date_key > filters.to) return false;
  }

  // Actions are matched case-insensitively on the whole value, so "user_login" and "USER_LOGIN" are
  // one action rather than two groups in the dropdown.
  if (filters.action && entry.action.toUpperCase() !== filters.action.toUpperCase()) return false;
  if (filters.member && entry.user_id !== filters.member) return false;

  return true;
}

// Missing values sort last in either direction, so an unparseable timestamp is never presented as
// the newest entry.
function compareLogText(aValue, bValue, direction) {
  const a = String(aValue || "");
  const b = String(bValue || "");
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return (a < b ? -1 : 1) * direction;
}

// Timestamp order.
//
// Compares the normalized sort key, so a cell holding a Date, an ISO string and the canonical text all
// land in the right order. An entry with no readable timestamp sorts LAST in both directions - an
// unparseable date must never be presented as the most recent entry - and the raw text only breaks a
// tie between two unreadable values, so the order stays stable rather than depending on sheet order.
function compareLogTimestamp(a, b, direction) {
  const aKey = String(a.sort_key || a.date_key || "");
  const bKey = String(b.sort_key || b.date_key || "");
  if (!aKey && !bKey) return compareLogText(a.timestamp, b.timestamp, direction);
  if (!aKey) return 1;
  if (!bKey) return -1;
  if (aKey !== bKey) return (aKey < bKey ? -1 : 1) * direction;
  return 0;
}

function sortLogEntries(entries, sort) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  const mode = LOG_SORTS.indexOf(String(sort || "")) === -1 ? LOG_SORT_DEFAULT : String(sort);

  return list.sort(function (a, b) {
    if (mode === "timestamp_asc") return compareLogTimestamp(a, b, 1);
    if (mode === "action_asc") {
      return compareLogText(a.action, b.action, 1) || compareLogTimestamp(a, b, -1);
    }
    if (mode === "member_asc") {
      return compareLogText(a.user_id, b.user_id, 1) || compareLogTimestamp(a, b, -1);
    }
    return compareLogTimestamp(a, b, -1);
  });
}

// One page of rows plus the numbers the footer and the pager need. The requested page is clamped, so
// asking for page 99 of a 3-page result returns the LAST page rather than an empty table - which is
// what would otherwise happen after narrowing a filter.
function paginateLogEntries(entries, page, pageSize) {
  const list = Array.isArray(entries) ? entries : [];
  const size = Math.min(
    LOG_PAGE_SIZE_MAX,
    Math.max(1, parseInt(pageSize, 10) || LOG_PAGE_SIZE_DEFAULT)
  );
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const wanted = Math.max(1, parseInt(page, 10) || 1);
  const current = Math.min(wanted, totalPages);
  const start = (current - 1) * size;

  return {
    rows: list.slice(start, start + size),
    page: current,
    page_size: size,
    total: total,
    total_pages: totalPages,
  };
}

// Every distinct action and member id present in the log, for the filter dropdowns.
//
// Taken from the WHOLE log rather than from the returned page, because a filter offering only the
// values on the current page could never select the value you were looking for. Members are returned
// as ids - the client already has the roster to put names to them - and the log also holds ids that
// are not members, since a failed sign-in is recorded against the typed username.
function logFacets(entries) {
  const actions = {};
  const members = {};
  (Array.isArray(entries) ? entries : []).forEach(function (entry) {
    if (!entry) return;
    if (entry.action) actions[entry.action] = true;
    if (entry.user_id) members[entry.user_id] = true;
  });

  return { actions: Object.keys(actions).sort(), members: Object.keys(members).sort() };
}

// The whole read, from sheet to response payload.
function systemLogPage(ss, request) {
  const data = request || {};
  const filters = {
    from: logCellText(data.from),
    to: logCellText(data.to),
    // `action_filter`, not `action`: `action` is the RPC envelope key, so the log's action FILTER has
    // to travel under a different name. Reading data.action here would filter every page on the
    // string "ADMIN_GET_SYSTEM_LOG" and return nothing.
    action: logCellText(data.action_filter),
    member: logCellText(data.member),
  };

  // A missing sheet is an empty log rather than an error: the tab should open on a station that has
  // never logged anything.
  const all = getSheetData(ss, "system_log").map(normalizeLogEntry);
  const matched = all.filter(function (entry) {
    return logEntryMatches(entry, filters);
  });
  const sorted = sortLogEntries(matched, data.sort);
  const paged = paginateLogEntries(sorted, data.page, data.page_size);
  const facets = logFacets(all);

  return {
    // The contract version, so the client can tell an old deployment from an empty log. See
    // SYSTEM_LOG_API_VERSION.
    api: SYSTEM_LOG_API_VERSION,
    rows: paged.rows,
    page: paged.page,
    page_size: paged.page_size,
    total: paged.total,
    total_pages: paged.total_pages,
    // Echoed back so the client can trust what was APPLIED rather than what it asked for.
    sort: LOG_SORTS.indexOf(logCellText(data.sort)) === -1 ? LOG_SORT_DEFAULT : logCellText(data.sort),
    actions: facets.actions,
    members: facets.members,
    log_total: all.length,
  };
}

// Utility: Get current timestamp formatted in Eastern Time (America/New_York)
function getEasternTimestamp() {
  return Utilities.formatDate(
    new Date(), 
    "America/New_York", 
    "yyyy-MM-dd HH:mm:ss"
  );
}

/**
 * Custom function to convert latitude/longitude into a street address.
 * Standardizes formatting and ignores Plus Codes (Open Location Codes).
 * 
 * @param {number|string} lat - Latitude
 * @param {number|string} lon - Longitude
 * @return {string} Formatted street address
 * @customfunction
 */
function GOOGLEMAPS_REVERSEGEOCODE(lat, lon) {
  if (!lat || !lon) return "";
  
  try {
    // Parse inputs as floats to ensure precision consistency
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    
    if (isNaN(latitude) || isNaN(longitude)) return "";

    const response = Maps.newGeocoder().reverseGeocode(latitude, longitude);
    
    if (response && response.status === "OK" && response.results.length > 0) {
      // Loop through results to find the first address that isn't a Plus Code
      for (let i = 0; i < response.results.length; i++) {
        const address = response.results[i].formatted_address;
        
        // Plus codes contain a '+' (e.g. "2GHPV328+58"). Skip them if a street address is available.
        if (address && !address.includes("+")) {
          return address;
        }
      }
      
      // Fallback: return the first result if all candidates contain plus codes
      return response.results[0].formatted_address;
    }
  } catch (err) {
    Logger.log("Geocoding failed for (" + lat + ", " + lon + "): " + err.toString());
  }
  
  return "";
}