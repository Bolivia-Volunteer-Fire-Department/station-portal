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

// Which way a month is moving, and the class that animates it.
//
// A month change is two phases, because the calendar only ever renders one month: the old one slides out of
// the card, and the SWAP HAPPENS WHILE IT IS OFF THE EDGE, so the new month is already painted where its own
// entry animation starts. To the eye it is one continuous slide; to the code it is a state change in the
// middle of one, which is why this cannot be a single animation on a keyed element.
//
// The phases are advanced by `animationend` rather than by timers - the animation is the clock - with the same
// escape hatch as above: a member who asked for less movement gets the next month instantly.
export function useMonthSlide(viewDate, setViewDate) {
  const [phase, setPhase] = useState(null);
  const [direction, setDirection] = useState(1);
  const pending = useRef(null);

  const reduced = useRef(prefersReducedMotion());
  useEffect(() => {
    reduced.current = prefersReducedMotion();
  }, []);

  // A month change asked for while one is in flight is DROPPED rather than queued: catching up on three
  // months of slides is not what a member who pressed Next three times wants to watch.
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
    (months) => stepTo(new Date(viewDate.getFullYear(), viewDate.getMonth() + months, 1)),
    [stepTo, viewDate]
  );

  const goTo = useCallback(
    (target) => stepTo(new Date(target.getFullYear(), target.getMonth(), 1)),
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
