import React from 'react'
import { iconElements } from '../../utils/mapIcons'

const STROKE_WIDTH = 2.2

export default function MapTypeGlyph({ icon, letter, size = 14, color = '#ffffff', className = '' }) {
  const isLetter = Boolean(letter || (typeof icon === 'string' && icon.startsWith('letter-')))
  if (isLetter) {
    const char = letter || icon.replace('letter-', '').toUpperCase()
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
        <text x="12" y="18" textAnchor="middle" fill={color} fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="18">
          {char}
        </text>
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {iconElements(icon).map(([tag, attributes], index) => React.createElement(tag, { ...attributes, key: index }))}
    </svg>
  )
}

export const glyphHtml = (icon, { size = 14, color = '#ffffff', strokeWidth = STROKE_WIDTH, letter } = {}) => {
  const isLetter = Boolean(letter || (typeof icon === 'string' && icon.startsWith('letter-')))
  if (isLetter) {
    const char = letter || icon.replace('letter-', '').toUpperCase()
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><text x="12" y="18" textAnchor="middle" fill="${color}" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="18">${char}</text></svg>`
  }
  const body = iconElements(icon).map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).map(([name, value]) => `${name}="${value}"`).join(' ')}/>`).join('')
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}