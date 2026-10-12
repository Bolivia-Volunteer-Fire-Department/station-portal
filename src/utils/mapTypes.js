import { MAP_ICON_KEYS } from './mapIcons.js';

// THE LANDMARK TYPES: what a pin on this station's map can BE - a name, an icon and a color, decided by the station rather
// than by the app. One document, like the boundary, because there is one set of them per station.
//
// IT IS A DOCUMENT AND NOT A SYSTEM SETTING for the same reason the boundary is: settings/public is read on EVERY sign-in,
// while the type list is read when the map opens (and kept on the device, so the map still names its own pins with no signal).
// A station that never opens the card gets the eight built-in types below, so this costs nothing to ignore.
//
// WHY A STATION-EDITED LIST AT ALL, when the app shipped eight fixed kinds: a hydrant is not the only thing a station wants to
// mark - a fill site, a dry hydrant, a gated access, a compressor, a landing zone - and a station that cannot add one ends up
// using "Other" for half its pins, which is a legend that says nothing. The list is CLOSED and BOUNDED (MAP_TYPE_LIMIT) for
// the opposite reason: every type is a dot on the map, and a legend of forty of them is not a legend.
export const MAP_TYPES_COLLECTION = 'map_types';
export const MAP_TYPES_DOC_ID = 'station';

// The most types a station may have, and the longest a name may be. Both are guards rather than tastes: the list is read when
// the map opens, and it is drawn as a legend beside the map - so the limits are about the screen staying readable.
export const MAP_TYPE_LIMIT = 24;
export const MAP_TYPE_LABEL_MAX = 30;
// A key is what a landmark REMEMBERS, so it is bounded and never re-derived from the label: see mapTypeKey.
export const MAP_TYPE_KEY_MAX = 40;

// THE COLOURS A TYPE MAY WEAR. A palette rather than a color picker, because these dots are read at a glance on a phone in
// the dark: every one of these has enough contrast against the pale map and the dark one, and the first eight below are the
// colours the built-in types already had. The picker shows them as swatches.
export const MAP_TYPE_COLOURS = [
  '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d', '#15803d', '#0d9488', '#0e7490',
  '#0284c7', '#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#a16207', '#475569', '#1e293b',
];

// THE STARTING LIST: the eight kinds the app shipped before types existed, with the colours they already had and an icon each.
//
// THE KEYS ARE THE OLD KIND NAMES ON PURPOSE. Every landmark already on a station's map stores `kind: 'hydrant'` and friends,
// so keeping these keys means the change needs NO migration and no pin moves or changes color. A station that renames
// "Hydrant" keeps the key `hydrant` (see mapTypeKey), which is the same promise in the other direction.
export const DEFAULT_MAP_TYPES = [
  { key: 'hydrant', label: 'Hydrant', icon: 'droplet', color: '#dc2626' },
  { key: 'water', label: 'Water source', icon: 'waves', color: '#0284c7' },
  { key: 'ramp', label: 'Boat ramp', icon: 'sailboat', color: '#0e7490' },
  { key: 'staging', label: 'Staging area', icon: 'flag', color: '#7c3aed' },
  { key: 'access', label: 'Access or gate', icon: 'key', color: '#a16207' },
  { key: 'hazard', label: 'Hazard', icon: 'triangle-alert', color: '#ea580c' },
  { key: 'station', label: 'Station or asset', icon: 'shield', color: '#15803d' },
  { key: 'other', label: 'Other', icon: 'map-pin', color: '#475569' },
];

// The type a landmark falls back to: a pin whose type was removed from the list still has to draw as SOMETHING, and a pin
// drawn as nothing is a pin somebody will report as lost.
export const MAP_TYPE_FALLBACK_KEY = 'other';

// Where the list is kept on the device, so the map opens with its pins already coloured and labelled. See utils/districtMap for
// the same promise made about the boundary and the landmarks.
export const MAP_TYPES_CACHE_KEY = 'sp_map_types';

// THE STYLE A PIN WEARS, built in ONE place because two things wear it - the saved landmarks and the pin being placed - and
// because getting it wrong is invisible in a way that costs a whole release.
//
// THE BUG THIS EXISTS TO PREVENT: the colour used to be appended to a shared string with no semicolon between them, which glued
// `box-shadow:0 1px 3px rgba(...)` to `background:#dc2626` into ONE declaration. A browser drops an invalid declaration WHOLE,
// so the pins lost their fill and drew as white glyphs on nothing - legible only over the pale map, and only just.
//
// So the colour goes FIRST (the declaration a pin cannot do without), the shared box ends in a semicolon, and
// `scripts/verify-district-map` parses what this returns and fails on any declaration that is not `name:value`. A test that
// reads the CSS the map actually draws with is the only kind that could have caught it.
export const MAP_PIN_BOX =
  'display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:9999px;' +
  'box-shadow:0 1px 3px rgba(15,23,42,0.45);';

export const mapPinStyle = (color, ring = '') => `background:${color};${ring}${MAP_PIN_BOX}`;

// Every declaration in a style string, so a caller can check what it is about to hand a browser. `[]` when anything in there is
// not `name:value` - which is the shape the bug above took.
//
// AT MOST ONE COLON PER DECLARATION, which is the part that catches it: a glued pair reads as `box-shadow:0 1px 3px rgba(...)
// background:#dc2626`, and a regex that only asked for "name: something" would happily call that a box-shadow. No value this app
// writes contains a colon, so a second one means two declarations were joined.
export const styleDeclarations = (style) => {
  const parts = String(style || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.every((part) => /^[a-z-]+:[^:]+$/i.test(part)) ? parts : [];
};

// A KEY FROM A NAME, stable once made. The label is what a person edits and the key is what a landmark stores, so renaming a
// type must NOT change the key: "Hydrant" becoming "Fire hydrant" would otherwise repaint two hundred pins as "Other".
//
// A duplicate gets a number rather than being refused, because two types wanting the same name is a normal thing to do while
// editing - "Water source" for the river and "Water source" again for the lake - and the app's job is to keep them apart.
export const mapTypeKey = (label, existing = []) => {
  const base =
    String(label || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAP_TYPE_KEY_MAX) || 'type';
  const taken = new Set((existing || []).map((type) => String(type?.key || '')));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${taken.size + 1}`;
};

// One type, normalised - and null when it cannot be stored. The checks run in the order a person meets them: the name first,
// because a nameless type is a color with no meaning.
export const mapTypeProblem = (input = {}, existing = []) => {
  const label = String(input.label ?? '').trim();
  if (!label) return 'Every type needs a name, or nobody can tell what its dots mean.';
  if (label.length > MAP_TYPE_LABEL_MAX) {
    return `“${label}” is ${label.length} characters, and a type's name holds ${MAP_TYPE_LABEL_MAX}.`;
  }
  const icon = String(input.icon ?? '').trim();
  if (!MAP_ICON_KEYS.includes(icon)) {
    return `“${icon || 'nothing'}” is not one of the icons this app draws. Pick one from the list.`;
  }
  const color = String(input.color ?? '').trim().toLowerCase();
  if (!MAP_TYPE_COLOURS.includes(color)) {
    return 'Pick one of the colours from the list — they are the ones that stay readable on the map.';
  }
  // THE KEY, when the editor is re-sending a type it was given: it has to be unique. The editor never invents one for a NEW
  // type - mapTypeFields derives it from the name - which is what keeps a rename from orphaning every landmark using it.
  const key = String(input.key || '').trim();
  const others = (existing || []).filter((type) => type && type !== input);
  if (key && others.some((type) => String(type.key) === key)) return 'Two types cannot share an internal key.';
  if (!key && others.some((type) => String(type.label || '').trim().toLowerCase() === label.toLowerCase())) {
    return `There is already a type called “${label}”. Give this one a different name.`;
  }
  return '';
};

export const mapTypeFields = (input = {}, existing = []) => {
  if (mapTypeProblem(input, existing)) return null;
  return {
    key: String(input.key || '').trim() || mapTypeKey(input.label, existing),
    label: String(input.label || '').trim().slice(0, MAP_TYPE_LABEL_MAX),
    icon: String(input.icon).trim(),
    color: String(input.color).trim().toLowerCase(),
  };
};

// The whole list, checked AS A LIST - what a save writes and what the reader accepts. null means refused, as everywhere else.
export const mapTypesProblem = (input) => {
  if (!Array.isArray(input)) return 'The landmark types have to be a list.';
  if (!input.length) return 'A map needs at least one type of landmark, or there is nothing to pin.';
  if (input.length > MAP_TYPE_LIMIT) {
    return `${input.length} types is more than the ${MAP_TYPE_LIMIT} a legend can hold. Remove some first.`;
  }
  const seen = new Set();
  for (const type of input) {
    const problem = mapTypeProblem(type, input);
    if (problem) return problem;
    const key = String(type.key || '').trim();
    if (seen.has(key)) return `Two types share the key “${key}”.`;
    seen.add(key);
  }
  return '';
};

export const mapTypesFields = (input) => (mapTypesProblem(input) ? null : input.map((type) => mapTypeFields(type)));

// WHAT A LANDMARK'S KIND RESOLVES TO. A stored kind that is not in the list - a type somebody removed, or a document written by
// a newer build of the app - answers the fallback rather than nothing, and a pin drawn as nothing is a pin somebody reports as
// lost.
export const mapTypeFor = (types, key) => {
  const list = Array.isArray(types) && types.length ? types : DEFAULT_MAP_TYPES;
  const wanted = String(key || '').trim();
  return (
    list.find((type) => type.key === wanted) ||
    list.find((type) => type.key === MAP_TYPE_FALLBACK_KEY) ||
    list[0] ||
    DEFAULT_MAP_TYPES[DEFAULT_MAP_TYPES.length - 1]
  );
};

// The document a save writes.
//
// `count` is stored rather than derived so the card can say what is stored without parsing the whole thing - the same habit the
// drawing and the boundary have, and the reason a card can report a size at all.
export const mapTypesDocument = (input, meta = {}) => {
  const fields = mapTypesFields(input);
  if (!fields) return null;
  return {
    types: fields,
    count: fields.length,
    updated_by: String(meta.author || '').slice(0, 80),
  };
};

// A stored document as the screen wants it: the list, or the built-in eight when there is nothing usable stored. A station that
// has never opened the card, and a document somebody edited by hand into nonsense, land in the same honest place - a map that
// still names its pins.
export const mapTypesView = (doc) => {
  const list = doc && typeof doc === 'object' && Array.isArray(doc.types) ? doc.types : null;
  if (!list || mapTypesProblem(list)) return DEFAULT_MAP_TYPES;
  return list.map((type) => mapTypeFields(type)).filter(Boolean);
};


