import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_EMOJI_GROUPS, CHAT_EMOJI_RECENTS_KEY, nextEmojiRecents } from '../../utils/chatEmoji';

/**
 * The emoji picker: a small grid of the ones a fire station actually sends, and the twelve you used last.
 *
 * NO DEPENDENCY, deliberately. The complete emoji set is about a megabyte of data and a search index, and this app ships
 * its own icons rather than a library (see the rank and certification icon pickers). What a station sends in a chat is
 * a shrug, a thumbs up, a truck and a fire - so the list is short, curated, and grouped, and it fits in a file.
 *
 * THE MOST-RECENT ROW IS THE PART THAT MATTERS. A picker without it makes everybody scroll for the same four characters,
 * so the used ones are remembered ON THE DEVICE (this is a preference, not data, so it never touches Firestore) and they
 * come back at the top.
 */
const readRecents = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_EMOJI_RECENTS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
};

export default function EmojiPicker({ onPick, onClose, align = 'right', only = null }) {
  const [recents, setRecents] = useState(readRecents);
  const wrapRef = useRef(null);

  // Clicking away closes it, which is what every other popover in this app does. Escape is handled by the panel, which
  // owns the keyboard while it is up.
  useEffect(() => {
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) onClose?.();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  const pick = useCallback(
    (emoji) => {
      const next = nextEmojiRecents(readRecents(), emoji);
      setRecents(next);
      try {
        localStorage.setItem(CHAT_EMOJI_RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable - the picker still works for this session */
      }
      onPick?.(emoji);
    },
    [onPick]
  );

  // WHAT THIS PICKER OFFERS. Two lists, and the difference between them is a rule rather than a preference:
  //
  //   * A COMPOSER'S PICKER offers every group, because a message can contain any emoji.
  //   * A REACTION PICKER IS TOLD `only`, because a reaction is a fixed set the server accepts - and drawing the composer's
  //     whole list beside a message meant most taps came back as "That is not one of the reactions." instead of a reaction.
  //     A picker that offers what it cannot deliver is worse than a smaller one.
  //
  // The recent row is FILTERED by the same list rather than dropped: the device's habit may include emoji from before, and an
  // unfiltered recent row would put the refused ones back at the top of the picker.
  const groups = useMemo(() => {
    const allowed = Array.isArray(only) && only.length ? only : null;
    // THE SAME GROUPS, NARROWED - not one group of everything. Keeping the labels is what makes a list of sixty emoji
    // scannable, and an earlier version of this replaced them with a single "Reactions" row, which is how a picker loses the
    // shape somebody has learned. Filtering per group means a caller can say "only these" without flattening the list.
    const base = allowed
      ? CHAT_EMOJI_GROUPS.map((group) => ({
          ...group,
          emoji: group.emoji.filter((emoji) => allowed.includes(emoji)),
        })).filter((group) => group.emoji.length)
      : CHAT_EMOJI_GROUPS;
    const recent = allowed ? recents.filter((emoji) => allowed.includes(emoji)) : recents;
    return recent.length ? [{ label: 'Recent', emoji: recent }, ...base] : base;
  }, [recents, only]);

  return (
    // A POPOVER, so it follows the app's popover convention (see verify-motion.mjs): positioned off the control it hangs
    // from, animating in with the same class and growing from the edge it is anchored to.
    //
    // IT HANGS OFF THE NEAREST POSITIONED ANCESTOR, WHICH IS WHY `align` EXISTS, and why a caller has to give it one.
    // `absolute` with `bottom-full` measures from the closest ancestor that is `relative` (or otherwise positioned), NOT
    // from the button - so a picker rendered in a container without one is positioned against the PAGE, and "just above the
    // button" becomes "just above the top of the screen", which is to say invisible. That is exactly how the smiley beside
    // a message looked broken for a while: the button was fine, the reaction reached the server, and the picker was drawn
    // off-screen where nobody could see it. Anything that renders this must put it inside a `relative` wrapper, or it will
    // be opening somewhere nobody is looking.
    //
    // `align` then picks the edge: `right` grows leftward from the anchor (right-aligned content, like your own messages)
    // and `left` grows rightward from it, so a picker anchored to a control near the left edge of a wide panel stays inside
    // it rather than hanging off the side.
    <div
      ref={wrapRef}
      className={`absolute bottom-full mb-2 z-20 max-h-72 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl animate-popoverIn dark:border-slate-700 dark:bg-slate-800 ${
        align === 'left' ? 'left-0 origin-bottom-left' : 'right-0 origin-bottom-right'
      }`}
      data-sound="none"
    >
      {groups.map((group) => (
        <div key={group.label} className="mb-1.5 last:mb-0">
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {group.label}
          </div>
          <div className="grid grid-cols-8 gap-0.5">
            {group.emoji.map((emoji) => (
              <button
                key={`${group.label}-${emoji}`}
                type="button"
                onClick={() => pick(emoji)}
                className="rounded-lg p-1 text-lg leading-none transition hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label={`Insert ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
