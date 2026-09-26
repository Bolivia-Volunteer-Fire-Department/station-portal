// Color for an assignment.
//
// There are two sources, in priority order:
//
//   1. The administrator's choice, from the `color` column on the assignments
//      sheet (Administration > Assignments). Validated on the way in and again
//      here, so a hand-edited or half-typed value falls back instead of painting
//      something unreadable.
//   2. The original deterministic hue, derived from the assignment id, used when
//      no color has been chosen. This keeps every existing assignment looking
//      exactly as it did before the column existed - a blank color is not the
//      same as "no color", it means "keep the automatic one".
//
// Pass whichever assignment rows the caller has: admins hold the full sheet
// (`assignments`), and members receive the same shape from GET_SCHEDULE.
//
// The derived hue: FNV-1a mixes the id string well (consecutive ids like 1, 2, 3
// land far apart), and the golden-angle multiplier spreads hues evenly around the
// wheel so neighbouring assignments stay visually distinct.

const HEX_COLOR = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Returns "#rrggbb" for a usable hex color, or null. Mirrors normalizeHexColor
// on the backend so both ends agree on what counts as a color.
export const parseHexColor = (value) => {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const match = HEX_COLOR.exec(raw);
  if (!match) return null;
  let hex = match[1].toLowerCase();
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return `#${hex}`;
};

export const configuredAssignmentColor = (id, assignments) => {
  if (!Array.isArray(assignments)) return null;
  const found = assignments.find((a) => String(a?.id) === String(id ?? ''));
  return found ? parseHexColor(found.color) : null;
};

// HSL -> "#rrggbb". Needed because the automatic color is chosen as a hue but
// every consumer wants a hex: <input type="color"> rejects anything else, and a
// single format keeps the picker, the swatch and the stored value comparable.
const hslToHex = (h, s, l) => {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = (((h % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const [r, g, b] =
    huePrime < 1 ? [chroma, second, 0]
      : huePrime < 2 ? [second, chroma, 0]
        : huePrime < 3 ? [0, chroma, second]
          : huePrime < 4 ? [0, second, chroma]
            : huePrime < 5 ? [second, 0, chroma]
              : [chroma, 0, second];
  const offset = lightness - chroma / 2;
  const channel = (value) => Math.round((value + offset) * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
};

export function assignmentColor(id, assignments) {
  const configured = configuredAssignmentColor(id, assignments);
  if (configured) return configured;

  const str = String(id ?? '');
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.codePointAt(i);
    hash = (hash * 16777619) & 0x7fffffff; // FNV prime
  }
  const hue = Math.round((hash * 137.50776) % 360); // golden angle
  // Same hue, saturation and lightness this app has always derived (medium-dark,
  // so white text on a colored pill stays readable) - only now expressed as hex.
  return hslToHex(hue, 70, 45);
}
