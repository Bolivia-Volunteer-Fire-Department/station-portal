import React from 'react';
import { iconElements } from '../utils/mapIcons';

// ONE GLYPH, DRAWN THE SAME WAY IN THREE PLACES.
//
// A landmark type's icon appears on the marker itself, in the picker that chooses it, and in the legend beside the map. Two of
// those are React and one of them is NOT: a Leaflet marker takes an HTML STRING (L.divIcon), not an element. So this file has
// both - the component, and the string - built from the same table of path data, because two drawings of the same icon that
// disagree is a bug nobody would think to look for.
//
// The icon geometry comes from lucide (utils/mapIcons is generated from it). Only the wrapper is ours: stroke color and
// weight are set here so a glyph reads against its own coloured disc in either color scheme.

// How thick a glyph is drawn. 2.2 at a 14px box keeps a droplet readable at marker size - thinner disappears on a phone screen
// in daylight, thicker closes up the small shapes.
const STROKE_WIDTH = 2.2;

export default function MapTypeGlyph({ icon, letter, size = 14, color = '#ffffff', className = '' }) {
  const isLetter = Boolean(letter || (typeof icon === 'string' && icon.startsWith('letter-')));
  if (isLetter) {
    const char = letter || icon.replace('letter-', '').toUpperCase();
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        aria-hidden="true"
      >
        <text
          x="12"
          y="18"
          textAnchor="middle"
          fill={color}
          fontFamily="system-ui, -apple-system, sans-serif"
          fontWeight="900"
          fontSize="18"
        >
          {char}
        </text>
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {iconElements(icon).map(([tag, attributes], index) => React.createElement(tag, { ...attributes, key: index }))}
    </svg>
  );
}

// THE SAME GLYPH AS MARKUP, for Leaflet. The attributes are lucide's own numbers and path data (trusted constants from a
// generated file) and the color is one of the palette's hexes, which the type list is validated against before it is stored -
// so nothing here is somebody's typed text.
export const glyphHtml = (icon, { size = 14, color = '#ffffff', strokeWidth = STROKE_WIDTH, letter } = {}) => {
  const isLetter = Boolean(letter || (typeof icon === 'string' && icon.startsWith('letter-')));
  if (isLetter) {
    const char = letter || icon.replace('letter-', '').toUpperCase();
    return (
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">` +
      `<text x="12" y="18" text-anchor="middle" fill="${color}" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="18">${char}</text>` +
      `</svg>`
    );
  }

  const body = iconElements(icon)
    .map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).map(([name, value]) => `${name}="${value}"`).join(' ')}/>`)
    .join('');
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
  );
};
