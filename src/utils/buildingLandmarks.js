import { glyphHtml } from '../components/map/MapTypeGlyph.jsx';
import { roundCoordinate } from './districtMap.js';

/**
 * Building-specific landmark types for Pre-Incident Plans (PIPs).
 * These are specialized tactical features located on or directly adjacent to a structure,
 * distinct from general district-wide map landmarks (like boat ramps, hydrants, stations).
 */
export const BUILDING_LANDMARK_TYPES = [
  {
    key: 'side_a',
    label: 'Side A (Alpha Side - Front)',
    shortLabel: 'Side A',
    letter: 'A',
    category: 'access',
    icon: 'letter-a',
    color: '#1d4ed8', // Royal Blue
    description: 'Designates the Alpha Side (Side A / Front / Address Face) of the building',
  },
  {
    key: 'side_b',
    label: 'Side B (Bravo Side - Left)',
    shortLabel: 'Side B',
    letter: 'B',
    category: 'access',
    icon: 'letter-b',
    color: '#2563eb', // Blue
    description: 'Designates the Bravo Side (Side B / Left side as viewed from Alpha)',
  },
  {
    key: 'side_c',
    label: 'Side C (Charlie Side - Rear)',
    shortLabel: 'Side C',
    letter: 'C',
    category: 'access',
    icon: 'letter-c',
    color: '#3b82f6', // Light Blue
    description: 'Designates the Charlie Side (Side C / Rear of the structure)',
  },
  {
    key: 'side_d',
    label: 'Side D (Delta Side - Right)',
    shortLabel: 'Side D',
    letter: 'D',
    category: 'access',
    icon: 'letter-d',
    color: '#60a5fa', // Sky Blue
    description: 'Designates the Delta Side (Side D / Right side as viewed from Alpha)',
  },
  {
    key: 'fdc',
    label: 'FDC (Fire Dept Connection)',
    shortLabel: 'FDC',
    category: 'suppression',
    icon: 'droplets',
    color: '#dc2626', // Red
    description: 'Fire Department Connection for sprinklers or standpipes',
  },
  {
    key: 'riser_room',
    label: 'Riser Room / Sprinkler Riser',
    shortLabel: 'Riser',
    category: 'suppression',
    icon: 'waves',
    color: '#0284c7', // Blue
    description: 'Sprinkler control valves, main drain, pressure gauges',
  },
  {
    key: 'facp',
    label: 'Fire Alarm Panel (FACP)',
    shortLabel: 'FACP',
    category: 'suppression',
    icon: 'siren',
    color: '#ea580c', // Orange
    description: 'Main Fire Alarm Control Panel or remote annunciator',
  },
  {
    key: 'standpipe',
    label: 'Standpipe Outlet / Connection',
    shortLabel: 'Standpipe',
    category: 'suppression',
    icon: 'plug',
    color: '#e11d48', // Rose
    description: 'Class I/II/III standpipe hose connection or roof manifold',
  },
  {
    key: 'fire_pump',
    label: 'Fire Pump Room',
    shortLabel: 'Pump',
    category: 'suppression',
    icon: 'container',
    color: '#059669', // Emerald
    description: 'Stationary fire pump, controller, and test header',
  },
  {
    key: 'electrical_shutoff',
    label: 'Electrical Main / Disconnect',
    shortLabel: 'Electric',
    category: 'utilities',
    icon: 'zap',
    color: '#d97706', // Amber
    description: 'Main electrical service disconnect, breaker room, or transformer',
  },
  {
    key: 'gas_shutoff',
    label: 'Gas / LPG Shutoff',
    shortLabel: 'Gas',
    category: 'utilities',
    icon: 'flame',
    color: '#ca8a04', // Yellow-amber
    description: 'Natural gas meter, main shutoff valve, or propane tank',
  },
  {
    key: 'water_shutoff',
    label: 'Domestic Water Shutoff',
    shortLabel: 'Water',
    category: 'utilities',
    icon: 'droplet',
    color: '#0891b2', // Cyan
    description: 'Main domestic water shutoff valve / curb stop',
  },
  {
    key: 'generator',
    label: 'Emergency Generator',
    shortLabel: 'Generator',
    category: 'utilities',
    icon: 'fuel',
    color: '#16a34a', // Green
    description: 'Standby generator, fuel source, and transfer switch',
  },
  {
    key: 'solar_shutoff',
    label: 'Solar PV Rapid Shutdown',
    shortLabel: 'Solar',
    category: 'utilities',
    icon: 'zap',
    color: '#eab308', // Yellow
    description: 'Rooftop solar rapid shutdown switch / inverter disconnect',
  },
  {
    key: 'hvac_shutoff',
    label: 'HVAC / Smoke Shutoff',
    shortLabel: 'HVAC',
    category: 'utilities',
    icon: 'wind',
    color: '#475569', // Slate
    description: 'HVAC emergency shutoff switch or smoke evacuation damper control',
  },
  {
    key: 'knox_box',
    label: 'Knox Box / Key Vault',
    shortLabel: 'Knox',
    category: 'access',
    icon: 'key',
    color: '#7c3aed', // Purple
    description: 'Rapid entry lockbox with master building keys and access cards',
  },
  {
    key: 'access_door',
    label: 'Primary Access / Entry Door',
    shortLabel: 'Entry',
    category: 'access',
    icon: 'door-open',
    color: '#0d9488', // Teal
    description: 'Preferred firefighter entry door or Knox keyway entrance',
  },
  {
    key: 'roof_access',
    label: 'Roof Access',
    shortLabel: 'Roof',
    category: 'access',
    icon: 'mountain',
    color: '#52525b', // Zinc
    description: 'Roof hatch, exterior access ladder, or roof stair bulkhead',
  },
  {
    key: 'elevator_bank',
    label: 'Elevator / Fire Recall',
    shortLabel: 'Elevator',
    category: 'access',
    icon: 'building-2',
    color: '#4f46e5', // Indigo
    description: 'Elevator lobby, machine room, or Phase I/II firefighter recall',
  },
  {
    key: 'hazmat_storage',
    label: 'HazMat / Chemical Storage',
    shortLabel: 'HazMat',
    category: 'hazards',
    icon: 'triangle-alert',
    color: '#b91c1c', // Crimson
    description: 'Hazardous materials storage, chemical locker, or SDS station',
  },
  {
    key: 'other_building',
    label: 'Other Building Feature',
    shortLabel: 'Other',
    category: 'hazards',
    icon: 'map-pin',
    color: '#64748b', // Slate
    description: 'Custom building feature, exterior utility, or site asset',
  },
];

export const BUILDING_LANDMARK_CATEGORIES = [
  { id: 'all', label: 'All Features' },
  { id: 'access', label: 'Orientation & Access' },
  { id: 'suppression', label: 'Fire Protection (FDC / Risers)' },
  { id: 'utilities', label: 'Utilities & Shutoffs' },
  { id: 'hazards', label: 'HazMat & Other' },
];

export const BUILDING_SIDES = [
  { value: 'Side A (Alpha - Front)', label: 'Side A (Alpha - Front)' },
  { value: 'Side B (Bravo - Left)', label: 'Side B (Bravo - Left)' },
  { value: 'Side C (Charlie - Rear)', label: 'Side C (Charlie - Rear)' },
  { value: 'Side D (Delta - Right)', label: 'Side D (Delta - Right)' },
  { value: 'Roof', label: 'Roof' },
  { value: 'Interior', label: 'Interior' },
  { value: 'Grounds / Perimeter', label: 'Grounds / Perimeter' },
];

export const BUILDING_FLOORS = [
  { value: 'Exterior', label: 'Exterior / Ground Level' },
  { value: '1st Floor', label: '1st Floor' },
  { value: '2nd Floor', label: '2nd Floor' },
  { value: '3rd Floor', label: '3rd Floor' },
  { value: '4th Floor+', label: '4th Floor+' },
  { value: 'Basement', label: 'Basement / Subgrade' },
  { value: 'Mezzanine', label: 'Mezzanine' },
  { value: 'Roof', label: 'Roof' },
];

export const buildingLandmarkTypeFor = (key) =>
  BUILDING_LANDMARK_TYPES.find((t) => t.key === key) ||
  BUILDING_LANDMARK_TYPES[BUILDING_LANDMARK_TYPES.length - 1];

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

export const normalizeBuildingLandmark = (item = {}) => {
  const lat = Number(item.latitude);
  const lng = Number(item.longitude);
  const validPos = Number.isFinite(lat) && Number.isFinite(lng);
  const typeDef = buildingLandmarkTypeFor(item.type);

  const defaultSide =
    typeDef.key === 'side_a'
      ? 'Side A (Alpha - Front)'
      : typeDef.key === 'side_b'
      ? 'Side B (Bravo - Left)'
      : typeDef.key === 'side_c'
      ? 'Side C (Charlie - Rear)'
      : typeDef.key === 'side_d'
      ? 'Side D (Delta - Right)'
      : 'Side A (Alpha - Front)';

  return {
    id: str(item.id || `blm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, 50),
    type: typeDef.key,
    label: str(item.label || typeDef.label, 100),
    latitude: validPos ? roundCoordinate(lat) : null,
    longitude: validPos ? roundCoordinate(lng) : null,
    side: str(item.side || defaultSide, 60),
    floor: str(item.floor || 'Exterior', 50),
    notes: str(item.notes, 500),
    created_at: str(item.created_at || new Date().toISOString(), 50),
  };
};

/**
 * Builds HTML for a high-contrast, professional fire-service Leaflet marker.
 * Includes a colored circular badge, icon, and optional text pill.
 */
export const buildingLandmarkMarkerHtml = (landmark, { isSelected = false } = {}) => {
  const typeDef = buildingLandmarkTypeFor(landmark.type);
  const iconMarkup = glyphHtml(typeDef.icon, {
    size: 14,
    color: '#ffffff',
    strokeWidth: 2.3,
    letter: typeDef.letter,
  });
  const selectedRing = isSelected ? 'ring: 3px solid #38bdf8; transform: scale(1.15);' : '';

  return `
    <div class="building-landmark-marker" style="
      position: relative;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      user-select: none;
      transition: transform 0.15s ease;
      ${selectedRing}
    ">
      <div style="
        display: flex;
        align-items: center;
        gap: 4px;
        background: ${typeDef.color};
        color: #ffffff;
        padding: 3px 6px;
        border-radius: 9999px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
        border: 2px solid #ffffff;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.025em;
        line-height: 1;
        white-space: nowrap;
      ">
        <span style="display: flex; align-items: center; justify-content: center; width: 14px; height: 14px;">
          ${iconMarkup}
        </span>
        <span style="text-shadow: 0 1px 2px rgba(0,0,0,0.4);">${typeDef.shortLabel}</span>
      </div>
      <div style="
        width: 0;
        height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-top: 6px solid ${typeDef.color};
        margin-top: -1px;
        filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));
      "></div>
    </div>
  `;
};

