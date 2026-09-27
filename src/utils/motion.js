import { useLayoutEffect, useRef } from 'react';

// Replays a CSS animation that is already on an element, whenever `dep` changes.
//
// The problem it solves is replaying without remounting. A module change replaces the contents of <main>,
// and the obvious way to make the transition run again is to re-key <main> - which also throws away its
// scroll position. That position is shared across modules today, and on a phone the scrolling element is
// the DOCUMENT rather than <main>, so re-keying would behave differently on the two platforms: the same
// trick, two different bugs.
//
// So the animation stays where it is and is wound back to the start instead. `getAnimations()` is the part
// that makes this clean: it hands back the animations the browser is actually running on the element -
// which means it returns NOTHING when `prefers-reduced-motion` has set `animation: none`, so the member's
// motion preference is honored without this hook knowing it exists (see the reduced-motion block in
// index.css).
//
// `useLayoutEffect`, not `useEffect`: effects run after the browser has painted, and winding the animation
// back then would show one full frame of the destination before the journey to it - a flicker, which is
// exactly what a 160ms transition is supposed to remove.
export function useReplayAnimation(dep) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof node.getAnimations !== 'function') return;

    node.getAnimations().forEach((animation) => {
      animation.currentTime = 0;
      animation.play();
    });
  }, [dep]);

  return ref;
}
