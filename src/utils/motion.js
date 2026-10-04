import { useCallback, useEffect, useRef, useState } from 'react';

// Shared behaviour for the animations in index.css, and the two places where CSS alone cannot do the job.

// Whether this member has asked their device for less movement.
//
// CSS already silences every animation for this preference (see the reduced-motion block in index.css), and
// anything driven by a CSS animation needs nothing more: with `animation: none` there is no animation, so
// there is nothing to decide. This exists for the two behaviors that are SEQUENCED in JavaScript, where
// "silenced" would otherwise mean "waited for" - see both users below.
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Dismisses a dialog through its exit animation.
//
// CSS can animate a dialog ARRIVING on its own, because mounting an element runs its animation. It cannot
// animate one LEAVING, because the parent unmounts it the moment its state changes - which is why the entry
// played and the exit was a single frame. So the class goes on before the callback does, and the callback
// waits for the animation to end.
//
// The paths that use this are the DISMISSALS: Escape, the backdrop, Cancel, and a modal's own close button.
// The two paths that deliberately do not are Confirm and a successful submit - there the 110ms would sit in
// front of the thing the member actually asked for (the write, the sign-in), and a dialog that lingers before
// acting reads as hesitation. Those close at once, with a toast or a changed row appearing a moment later.
//
// Three ways out, because a dialog that never closes is worse than one that closes abruptly:
//   * `animationend`, the good path;
//   * a timer, for a browser that never fires it;
//   * no animation at all when the preference is set, or when there is nothing to animate.
export function useDismissAnimation(onDismiss) {
  const ref = useRef(null);
  const dismissing = useRef(false);

  const dismiss = useCallback(() => {
    const node = ref.current;

    if (dismissing.current) return;
    if (!node || prefersReducedMotion()) {
      onDismiss?.();
      return;
    }

    dismissing.current = true;
    node.classList.add('animate-overlayOut');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      node.removeEventListener('animationend', finish);
      window.clearTimeout(fallback);
      onDismiss?.();
    };

    node.addEventListener('animationend', finish);
    // Longer than the exit itself, and only reached if `animationend` never arrives.
    const fallback = window.setTimeout(finish, 400);
  }, [onDismiss]);

  return { ref, dismiss };
}

// Which way the view is moving, and the class that animates it.
//
// A month change is two phases, because the calendar only ever renders one month: the old one slides out of
// the card, and the SWAP HAPPENS WHILE IT IS OFF THE EDGE, so the new month is already painted where its own
// entry animation starts. To the eye it is one continuous slide; to the code it is a state change in the
// middle of one, which is why this cannot be a single animation on a keyed element.
//
// The phases are advanced by `animationend` rather than by timers - the animation is the clock - with the same
// escape hatch as above: a member who asked for less movement gets the next month instantly.
//
// `unit` IS WHAT THE ARROWS WALK: a month (the default) or a day, which is what a narrow screen shows instead of the
// month (see utils/viewport). An option on this hook rather than a second hook, because the slide IS the same either
// way: a day that animated differently from a month would be two calendars wearing one card.
//
// THE DAY IS KEPT IN BOTH UNITS, clamped into the month it lands in - so the 31st becomes the 28th or the 30th rather
// than silently becoming the 1st. That is what lets a window be narrowed and widened again without forgetting the day
// the member was reading: the month view does not draw the day, so keeping it costs that view nothing. Both callers
// only ever read the year and month off this date, and the one date-based comparison this hook makes (which way the
// view is moving) stays correct because clamping can never step past the month it was asked for.
const addMonthsKeepingDay = (date, months) => {
  const landing = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(landing.getFullYear(), landing.getMonth() + 1, 0).getDate();
  return new Date(landing.getFullYear(), landing.getMonth(), Math.min(date.getDate(), lastDay));
};

export function useMonthSlide(viewDate, setViewDate, unit = 'month') {
  const [phase, setPhase] = useState(null);
  const [direction, setDirection] = useState(1);
  const pending = useRef(null);

  const reduced = useRef(prefersReducedMotion());
  useEffect(() => {
    reduced.current = prefersReducedMotion();
  }, []);

  // A change asked for while one is in flight is DROPPED rather than queued: catching up on three months of slides is
  // not what a member who pressed Next three times wants to watch.
  const stepTo = useCallback(
    (next) => {
      if (phase) return;
      if (reduced.current) {
        setViewDate(next);
        return;
      }
      setDirection(next > viewDate ? 1 : -1);
      pending.current = next;
      setPhase('out');
    },
    [phase, setViewDate, viewDate]
  );

  const goBy = useCallback(
    (steps) =>
      stepTo(
        unit === 'day'
          ? new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate() + steps)
          : addMonthsKeepingDay(viewDate, steps)
      ),
    [stepTo, viewDate, unit]
  );

  // `goTo` KEEPS THE TARGET'S OWN DAY, because its one caller is Today: the target IS the answer. Re-deriving the day
  // from the view date would make the button mean "today's month, on whatever day I happened to be looking at".
  const goTo = useCallback(
    (target) => stepTo(new Date(target.getFullYear(), target.getMonth(), target.getDate())),
    [stepTo]
  );

  const onAnimationEnd = useCallback(() => {
    if (phase === 'out') {
      if (pending.current) setViewDate(pending.current);
      pending.current = null;
      setPhase('in');
      return;
    }
    if (phase === 'in') setPhase(null);
  }, [phase, setViewDate]);

  const gridClass =
    phase === 'out'
      ? direction > 0 ? 'animate-monthOutLeft' : 'animate-monthOutRight'
      : phase === 'in'
        ? direction > 0 ? 'animate-monthInRight' : 'animate-monthInLeft'
        : '';

  return { gridClass, onAnimationEnd, goBy, goTo, sliding: !!phase };
}
