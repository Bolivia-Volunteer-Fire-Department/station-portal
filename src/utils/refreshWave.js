// Running a wave of background refreshes, and giving the ones that failed a second chance.
//
// Why this exists: the post-sign-in wave is a stack of separate Apps Script executions, and the backend runs one
// at a time. When the queue is long enough, the calls at the END of it run out of the client's 60-second patience -
// and until now nothing asked them again. The result was an app that looked loaded and quietly was not: no shifts
// on the calendar, a 12-hour clock for a member who chose 24, and one console error naming whichever call happened
// to give up last. Reloading was the only cure.
//
// So: run the wave, then retry the failures ONCE, one at a time. Sequentially is the point - retrying them in
// parallel would rebuild the queue that caused the failure - and once is the point, because a second attempt is
// what an impatient app looks like when the backend is genuinely down.
//
// The three statuses are the whole contract, and the distinction matters:
//
//   'ok'       the data arrived
//   'failed'   it did not, and is worth trying again
//   'expired'  the session was refused, so retrying is pointless and would be noise
//
// A task that throws is a 'failed' task - a refresher that cannot even build its request has the same remedy as one
// whose request timed out.
//
// Pure and dependency-free (the sleep is injected), so it can be exercised without a browser - see
// scripts/verify-refresh-wiring.mjs.
export const REFRESH_OK = 'ok';
export const REFRESH_FAILED = 'failed';
export const REFRESH_EXPIRED = 'expired';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const statusOf = async (run) => {
  try {
    const status = await run();
    return status === REFRESH_OK || status === REFRESH_EXPIRED ? status : REFRESH_FAILED;
  } catch {
    return REFRESH_FAILED;
  }
};

/**
 * Runs `tasks` (`[{ name, run }]`) together, then retries the failed ones once, sequentially.
 *
 * Returns `{ ok, expired, recovered, missing }` - the names in each group. `missing` is what is still not loaded
 * when the wave is over, which is the only list worth reporting to a reader.
 */
export const runRefreshWave = async (tasks, { retryDelayMs = 1200, sleep = defaultSleep, onSettle } = {}) => {
  const list = Array.isArray(tasks) ? tasks : [];
  // Reported as each task settles rather than when the wave is over, so a caller driving a progress indicator
  // counts a failure the same as a success - the bug that once left a toast stuck at "9 of 10 done" forever.
  const announce = (task, status, pass) => {
    if (typeof onSettle === 'function') onSettle({ name: task.name, status, pass });
  };

  const first = await Promise.all(
    list.map(async (task) => {
      const status = await statusOf(task.run);
      announce(task, status, 1);
      return { task, status };
    })
  );

  const failed = first.filter((entry) => entry.status === REFRESH_FAILED);
  const retried = [];
  for (const entry of failed) {
    // The pause is deliberate: it is the time the queue needs to drain, and it is what makes the second attempt
    // land on an idle backend rather than the back of the same queue.
    if (retryDelayMs > 0) await sleep(retryDelayMs);
    const status = await statusOf(entry.task.run);
    announce(entry.task, status, 2);
    retried.push({ task: entry.task, status });
  }

  const names = (entries, status) => entries.filter((e) => e.status === status).map((e) => e.task.name);
  return {
    ok: names(first, REFRESH_OK),
    expired: names(first, REFRESH_EXPIRED),
    recovered: names(retried, REFRESH_OK),
    missing: retried.filter((entry) => entry.status !== REFRESH_OK).map((entry) => entry.task.name),
  };
};
