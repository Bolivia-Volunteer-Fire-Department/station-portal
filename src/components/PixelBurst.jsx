import React, { useMemo } from "react";

// The palette the burst is drawn from: the game's yellow and red, a warm highlight, and white, so the
// hint reads as the same pixel family as the minigame it points at.
const BURST_COLORS = ["#ffd23f", "#d92d20", "#f97316", "#ffffff"];

// A small deterministic hash - a number in [0, 1) from any seed. Used rather than Math.random so the
// scatter is PURE: randomness during render is a purity error (the value would change on any re-render,
// a theme change or a badge arriving, and reshuffle a burst already in flight), while a hash of the
// burst number and the particle index is stable and still different on every press.
const noise = (seed) => {
  const value = Math.sin(seed) * 43758.5453;
  return value - Math.floor(value);
};

// A little pixelated scatter, fired from a logo on each press - the hint that the logo is worth
// pressing (the easter egg opens on the sixth). It re-fires whenever `trigger` changes, which is every
// press, because the parent counts them. The animation and the reduced-motion handling live in
// index.css with the rest of the app's motion.
export default function PixelBurst({ trigger, count = 12, spread = 30 }) {
  const particles = useMemo(() => {
    if (!trigger) return [];
    return Array.from({ length: count }, (_, index) => {
      // Evenly spaced bearings with a little jitter, so a burst never reads as a clock face.
      const jitter = noise(trigger * 37 + index * 3 + 1);
      const drift = noise(trigger * 37 + index * 3 + 2);
      const sizeRoll = noise(trigger * 37 + index * 3 + 3);
      const angle = (index / count) * Math.PI * 2 + jitter * 0.6;
      const distance = spread * (0.55 + drift * 0.65);
      return {
        id: `${trigger}-${index}`,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        size: 3 + Math.round(sizeRoll * 2),
        color: BURST_COLORS[index % BURST_COLORS.length],
      };
    });
  }, [trigger, count, spread]);

  if (particles.length === 0) return null;

  return (
    <span className="pixel-burst" aria-hidden="true">
      {particles.map((particle) => (
        <span
          key={particle.id}
          className="pixel-burst__particle"
          // The two offsets and the paint are per-particle, so the one keyframe can place all twelve.
          style={{
            "--pixel-x": `${particle.x.toFixed(1)}px`,
            "--pixel-y": `${particle.y.toFixed(1)}px`,
            "--pixel-size": `${particle.size}px`,
            "--pixel-color": particle.color,
          }}
        />
      ))}
    </span>
  );
}

