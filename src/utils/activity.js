// Reporting on a background refresh wave.
//
// A save is one write, but the screen behind it reloads ten things, and the app no longer waits for them (see
// utils/savedRow.js). Without some feedback that reads as "nothing happened" - the buttons release, the table
// updates itself a few seconds later, and there is no sign anything was in flight. So each wave reports
// itself through a toast that counts up and then gets out of the way.
//
// The counting and the wording live here, apart from sonner, so the behaviour can be exercised directly:
// the toast library is injected as three callbacks.
//
// Toasts are keyed by an id this module never reuses, so a wave that starts while another is still running
// STACKS rather than replacing it - which matters at sign-in, when the admin wave and the member wave overlap.

// How a wave in progress reads. Deliberately plain: the count is the useful part, and a spinning toast stops
// the reader wondering whether the click registered.
export const waveMessage = (label, settled, total) => {
  if (total <= 0) return label;
  if (settled <= 0) return `${label}…`;
  return `${label} — ${settled} of ${total} done…`;
};

export const waveDoneMessage = (label, failed = 0) =>
  failed > 0
    ? `${label} — ${failed} could not be refreshed`
    : `${label} — up to date`;

// A reporter for ONE wave.
//
//   const reporter = createWaveReporter({ label: 'Refreshing views', total: requests.length, onProgress, onDone });
//   requests.map((request) => request.then(() => reporter.settle(true), () => reporter.settle(false)));
//
// `settle` is called once per request, in any order, and completion fires exactly once even if it is called
// more times than `total` (a promise that resolves twice would otherwise re-fire the toast).
//
// It takes a success flag because a request that FAILED still has to count. The first version counted only
// successful settles, so a request that was aborted left the toast saying "9 of 10 done…" forever - the
// number never reached its total and the wave never reported that anything was wrong.
export const createWaveReporter = ({ label, total, onProgress, onDone } = {}) => {
  const count = Number.isFinite(total) && total > 0 ? total : 0;
  let settled = 0;
  let failed = 0;
  let finished = false;

  return {
    get settled() {
      return settled;
    },
    get failed() {
      return failed;
    },
    settle(ok = true) {
      if (finished) return;
      settled += 1;
      if (ok === false) failed += 1;

      if (settled < count) {
        if (typeof onProgress === 'function') onProgress(waveMessage(label, settled, count), settled, count);
        return;
      }

      finished = true;
      if (typeof onDone === 'function') onDone(waveDoneMessage(label, failed), count, failed);
    },
  };
};

// Ids are never reused, so concurrent waves stack. Kept here rather than in the component so the rule is
// testable: two reporters created in a row must not share an id.
let waveSerial = 0;
export const nextWaveId = () => {
  waveSerial += 1;
  return `refresh-wave-${waveSerial}`;
};
