// The district map as REAL GEOGRAPHY: the boundary polygon and the landmarks, both in latitude and longitude.
//
// WHAT A LANDMARK CAN BE - a name, an icon and a color, decided by the station - lives in utils/mapTypes.js, because it is a
// document a station edits rather than a list this app ships. Two things are borrowed from there: the key a pin falls back to
// when the type it remembers has been removed, and the bound on the key it may store.
import { MAP_TYPE_FALLBACK_KEY, MAP_TYPE_KEY_MAX, MAP_TYPES_CACHE_KEY } from './mapTypes.js';

// WHY THIS IS NOT A DRAWING. The module began with an uploaded SVG - a sheet with no coordinates in it - and a sheet can
// only be looked at. It cannot be pinned, cannot be measured, cannot be shown beside a neighbouring district, and cannot
// survive being redrawn. The station's own sheet was also 10 MB, which is what a traced raster looks like when it is
// stored as vector. The county publishes the real thing instead: the beat boundary as a polygon in latitude/longitude,
// 2,245 points for Bolivia's district, which is 51 KB once it is rounded to six decimal places - and it is the county's
// official line rather than the station's copy of it.
//
// SO THE BOUNDARY IS COPIED, NOT LINKED. An officer fetches it once (services/countyGis.js) and the app stores the
// geometry in its own document: after that the map reads nothing from the county, works with no signal, and does not break
// the day somebody else's server is retired. Refreshing it is a thing an officer does when the county redraws, which is
// about once a year.
//
// THE GEOMETRY IS STORED AS TEXT, and that is a database rule rather than a taste. Firestore refuses an array that
// contains an array, and GeoJSON coordinates are arrays of arrays of positions - so the document holds the GeoJSON as a
// STRING and the app parses it (utils/mapLayer stores the drawing's SVG text for the same shape of reason).
//
// WHAT IS PURE HERE. Everything but the three cache pairs is a plain function over data, so scripts/verify-district-map.mjs
// can put the refusals, the rounding and the bounds through their cases without a browser: a boundary that is accepted but
// nonsense, or refused for a reason nobody can act on, is not something a rendered map would ever show.

import { MAP_LAYER_MAX_BYTES as MAP_DOCUMENT_MAX_BYTES } from './mapLayer.js';

export const MAP_BOUNDARY_COLLECTION = 'map_boundaries';
// ONE FIXED ID, like the drawing's and like `settings/public`: there is one district boundary per station.
export const MAP_BOUNDARY_DOC_ID = 'district';
export const MAP_LANDMARK_COLLECTION = 'map_landmarks';

// SIX DECIMAL PLACES IS ABOUT 11 CENTIMETRES of the ground, which is finer than any district line is drawn and finer than
// a phone's GPS. The county hands its coordinates over with fifteen, which is a thousandth of a millimetre and roughly a
// third of the file - so rounding here is a saving, not a loss. See scripts/inspect-map-svg.mjs for the drawing's version
// of the same argument.
export const MAP_COORDINATE_DECIMALS = 6;

// The same document cap as the drawing, for the same reason: Firestore refuses a document over 1 MB, and a refusal at save
// time has no message an officer can act on. A county boundary is ~50 KB; this is the backstop.
export const MAP_BOUNDARY_MAX_POINTS = 40000;

// WHAT A LANDMARK CAN BE lives in utils/mapTypes.js, because it is a DOCUMENT the station edits (a name, an icon and a color
// each) rather than a list the app ships. What stays here is the part that does not depend on that list: the bounds of the key
// a landmark stores, and the key it falls back to when the type it remembers is gone.
export const LANDMARK_LABEL_MAX = 60;
export const LANDMARK_NOTE_MAX = 280;

// How many pins the map reads in one go. A station with a pin per hydrant is a few hundred; this is a GUARD rather than a
// page, because a map that quietly drew half its own pins would be worse than one that said it had too many - and unlike
// the schedule, the whole set is what the screen is for.
export const MAP_LANDMARK_LIMIT = 500;

// A STORED KIND, BOUNDED BUT NOT ENUMERATED. The list of kinds is the station's document now, so this module cannot check a
// kind against it - and must not try, because the writer would then need to read that document to save a pin. What it can do is
// refuse a value that could not have come from the picker: empty, over-long, or not a slug.
//
// A pin whose kind is not in the station's list still draws (utils/mapTypes#mapTypeFor), so a refused key costs nothing but a
// grey dot - and an accepted one that is nonsense would cost a pin nobody can name.
export const landmarkKindKey = (value) => {
  const key = String(value ?? '').trim().slice(0, MAP_TYPE_KEY_MAX);
  return /^[a-z0-9][a-z0-9-]*$/.test(key) ? key : '';
};

// The device's copies, so the map draws with no signal - the same promise the drawing's cache makes. Two keys rather than
// one: the boundary is the station's, the landmarks are the station's, and either can exist without the other.
export const MAP_BOUNDARY_CACHE_KEY = 'sp_district_boundary';
export const MAP_LANDMARK_CACHE_KEY = 'sp_district_landmarks';

// One coordinate, rounded to the precision above. Negative zero is normalised away because it is a number no reader needs
// and it costs a byte in every written form.
export const roundCoordinate = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return Number.NaN;
  const factor = 10 ** MAP_COORDINATE_DECIMALS;
  const rounded = Math.round(number * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

// Whatever shape the caller has - a FeatureCollection from the county, one Feature, a bare geometry, a list of rings, or
// the TEXT a document holds - turned into a geometry, or null when there is nothing usable in it.
const parsedIfText = (input) => {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
};

export const boundaryGeometry = (input) => {
  const value = parsedIfText(input);
  if (!value || typeof value !== 'object') return null;
  // A FeatureCollection is what the county answers with, and what a saved file may hold for several departments.
  if (Array.isArray(value.features)) return value.features.map(boundaryGeometry).find(Boolean) || null;
  if (value.type === 'Feature') return boundaryGeometry(value.geometry);
  if (value.type === 'Polygon' && Array.isArray(value.coordinates)) {
    return { type: 'Polygon', coordinates: value.coordinates };
  }
  if (value.type === 'MultiPolygon' && Array.isArray(value.coordinates)) {
    return { type: 'MultiPolygon', coordinates: value.coordinates };
  }
  // A bare list of rings, which is what a polygon cut out by hand usually arrives as.
  if (Array.isArray(value) && Array.isArray(value[0]) && Array.isArray(value[0][0])) {
    return { type: 'Polygon', coordinates: value };
  }
  return null;
};

// Every ring, whether the geometry is one polygon or several. Rings matter because a polygon's SECOND ring is a hole - a
// district that surrounds somebody else's has one - so they are never flattened away.
export const geometryRings = (geometry) => {
  const value = boundaryGeometry(geometry);
  if (!value) return [];
  if (value.type === 'Polygon') return value.coordinates.filter(Array.isArray);
  return value.coordinates.flatMap((polygon) => (Array.isArray(polygon) ? polygon : [])).filter(Array.isArray);
};

export const geometryPointCount = (geometry) =>
  geometryRings(geometry).reduce((total, ring) => total + ring.length, 0);

// The box the boundary occupies, in Leaflet's order - [[south, west], [north, east]] - which is what the screen fits its
// view to, and what a check can compare against the county's own extent.
export const geometryBounds = (geometry) => {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  let counted = 0;
  geometryRings(geometry).forEach((ring) => {
    ring.forEach((position) => {
      // GeoJSON positions are [longitude, latitude] - the opposite way round from how everybody says it, and from how
      // Leaflet takes them. This is the one line where getting it backwards looks like a map of the wrong country.
      const lng = Number(position?.[0]);
      const lat = Number(position?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      counted += 1;
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
    });
  });
  return counted ? [[south, west], [north, east]] : null;
};

// The geometry as it will be stored: every coordinate rounded to the precision above, structure untouched.
export const roundGeometry = (geometry) => {
  const value = boundaryGeometry(geometry);
  if (!value) return null;
  const roundRing = (ring) => ring.map((position) => [roundCoordinate(position?.[0]), roundCoordinate(position?.[1])]);
  return value.type === 'Polygon'
    ? { type: 'Polygon', coordinates: value.coordinates.map(roundRing) }
    : { type: 'MultiPolygon', coordinates: value.coordinates.map((polygon) => polygon.map(roundRing)) };
};

// Why a boundary cannot be used - an empty string when it can.
//
// EVERY MESSAGE NAMES THE THING TO DO. A boundary arrives either from the county (well-formed, and a refusal there would be
// a fault on their side) or from a file an officer exported out of a GIS system - where "that is not a polygon" and "one of
// these points is not a coordinate" are two different afternoons.
export const boundaryProblem = (input) => {
  const geometry = boundaryGeometry(input);
  if (!geometry) {
    return 'That does not hold a district boundary. Export the boundary as GeoJSON from a GIS system - a polygon or a multipolygon - and upload that file.';
  }

  const rings = geometryRings(geometry);
  if (!rings.length) return 'That boundary has no rings in it, so there is nothing to draw.';

  const thin = rings.find((ring) => ring.length < 3);
  if (thin) {
    return `A ring of that boundary has only ${thin.length} point(s) in it, and a shape needs at least three.`;
  }

  // A point that is not a number, or that is off the planet, is the one fault that draws a plausible-looking line in the
  // wrong hemisphere - which is exactly the kind that gets noticed a year later, by somebody standing in a field.
  const broken = rings.some((ring) =>
    ring.some((position) => {
      const lng = Number(position?.[0]);
      const lat = Number(position?.[1]);
      return !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180;
    })
  );
  if (broken) {
    return 'That boundary has a point that is not a longitude and a latitude, or that is off the planet. Check the file was exported in latitude/longitude - WGS 84, EPSG 4326 - rather than in a projected grid.';
  }

  const points = geometryPointCount(geometry);
  if (points > MAP_BOUNDARY_MAX_POINTS) {
    return `That boundary has ${points.toLocaleString()} points, and the most this app can store is ${MAP_BOUNDARY_MAX_POINTS.toLocaleString()}. Simplify it in your GIS system first - a district line does not need metre-by-metre detail.`;
  }

  const bytes = JSON.stringify(roundGeometry(geometry)).length;
  if (bytes > MAP_DOCUMENT_MAX_BYTES) {
    return `That boundary is ${Math.round(bytes / 1024)} KB once its coordinates are rounded, which is more than the ${Math.round(MAP_DOCUMENT_MAX_BYTES / 1024)} KB a station can store. Simplify it in your GIS system first.`;
  }

  return '';
};

// The document a save writes: the geometry as TEXT (Firestore refuses an array that contains an array, and GeoJSON
// coordinates are arrays of arrays), its own measurements, and where it came from. null means refused, and the caller has
// already shown the reason.
export const boundaryDocument = (input, meta = {}) => {
  if (boundaryProblem(input)) return null;
  const geometry = roundGeometry(input);
  const bounds = geometryBounds(geometry);
  const text = (value, max) => String(value ?? '').trim().slice(0, max);
  return {
    geojson: JSON.stringify(geometry),
    geometry_type: geometry.type,
    points: geometryPointCount(geometry),
    // A flat map of four numbers rather than the nested pair the screen uses: the screen can rebuild its shape in one line,
    // and this way nothing in the document is an array inside an array.
    bounds: { south: bounds[0][0], west: bounds[0][1], north: bounds[1][0], east: bounds[1][1] },
    // The county's own words for whose line this is, so the map can say "BOLIVIA FD BEAT 7" - and so a department handed
    // the wrong beat can see that it has been.
    label: text(meta.label, 80),
    agency: text(meta.agency, 100),
    agency_abbrv: text(meta.agency_abbrv, 10),
    zone: text(meta.zone, 20),
    service_num: text(meta.service_num, 20),
    source: text(meta.source, 120),
    source_url: text(meta.source_url, 300),
  };
};

// What the SCREEN needs from a stored boundary: the geometry Leaflet draws, the box to fit the view to, and the county's own
// words about whose line it is. null when nothing is stored, or when what is stored cannot be drawn.
export const boundaryView = (doc) => {
  if (!doc) return null;
  const geometry = boundaryGeometry(doc.geojson);
  if (!geometry) return null;
  const bounds = geometryBounds(geometry);
  if (!bounds) return null;
  return {
    geometry,
    bounds,
    points: Number(doc.points) > 0 ? Number(doc.points) : geometryPointCount(geometry),
    label: String(doc.label || ''),
    agency: String(doc.agency || ''),
    agency_abbrv: String(doc.agency_abbrv || ''),
    zone: String(doc.zone || ''),
    service_num: String(doc.service_num || ''),
    source: String(doc.source || ''),
    source_url: String(doc.source_url || ''),
    updated_at: String(doc.updated_at || ''),
  };
};

// --------------------------------------------------------------------------------------------------------------
// THE BACKGROUND: the county's roads and waterways, copied the same way the boundary is.
//
// WHY A COPY RATHER THAN A LIVE TILE LAYER, which is the obvious way to do this and the wrong one here. A tile layer would
// put a third party's server in the path of the one screen that has to work in a truck with no signal, and it would need an
// API key, a usage policy and somebody's bill. So roads and water are fetched ONCE, CLIPPED TO THE DISTRICT, and stored as
// the station's own geometry: the map draws them from a local copy, at any zoom, with no network. They change about once a
// year, so refreshing them is a button rather than a subscription.
//
// THE NUMBERS THAT MAKE IT PRACTICAL, measured against Bolivia's own beat (2,245 points, 13 km across): the county's roads
// inside the district are 398 lines, and the water is 54 streams and 110 lakes and ponds. At full survey detail that is
// 1.4 MB, most of it shoreline nobody can see at this scale - so the county is asked to GENERALISE it (its own
// `maxAllowableOffset`, a tolerance rather than a point count), which lands the whole background at about 300 KB: inside one
// document per layer, and small enough to keep on the device.
//
// THE TOLERANCES DIFFER ON PURPOSE. A road is a line with corners and cutting one is visible from a street, so roads are
// generalised to about a metre. A shoreline is a curve at a scale where nobody measures it, so water is generalised to
// about five - and that is where most of the saving is, because lakes and creeks are where the vertex count actually lives.
//
// WHAT WAS ADDED, AND WHY IT IS STILL THE SAME FEATURE. Two layers came later, both from the county's own open data and both
// COPIED the same way: the FEMA flood zones, and the fire districts AROUND this one. Neither is a new kind of thing - each is
// one more clipped, generalised, stored line-or-shape layer, fetched by a button and drawn from the station's own records -
// so they are the same document shape, the same card, the same cache and the same chip row. The measured numbers, against the
// same beat: 99 flood polygons and nine neighbouring beats, which is 80 KB and 106 KB once generalised - and the neighbouring
// beats are named, so the layer answers "whose ground is that?" as well as drawing it.
//
// AND ONE OF THEM CHANGED THE CLIP, which is the one thing here that was not purely additive. The flood zones are clipped to
// the district, because a crew only ever asks about ground it answers calls on. The roads and the districts around it are
// clipped to the district PLUS A BAND, because a district line runs down the middle of roads and along other districts'
// doorsteps: a map that stopped dead at the red line could not show the road a member is standing on the far side of, nor
// whose ground is next door. See MAP_BACKDROP_CLIP below, and the band's own note for what it costs.
export const MAP_BACKDROP_COLLECTION = 'map_backdrops';

// ONE DOCUMENT PER LAYER, under a fixed id: `map_backdrops/roads`, `/water`, `/flood`, `/districts`, `/neighbourRoads`. One each
// rather than one document for all of them because they come from different services, are fetched and refreshed independently,
// and together would sit well past a document's 900 KB ceiling - a ceiling worth keeping distance from, since the next
// county's roads may be denser. The firestore rule names these ids, because the id IS the layer: a typo would otherwise write a
// document that nothing reads and nothing draws.
export const MAP_BACKDROP_LAYERS = ['roads', 'water', 'flood', 'districts', 'neighbourRoads'];

// What each layer is called and drawn with. The colours live here beside the labels, as the landmark kinds do, so the map's
// legend and its rendering cannot disagree about what "waterways" looks like.
//
// FIVE LAYERS, AND A DELIBERATE ORDER TO THE CHIPS: our own ground first (roads, water), then what happens to it (the flood
// zones), then whose ground is next door (the districts), and last the MAJOR roads out there - the roads a crew crosses to
// reach a neighbour. The map draws them in the same order, so the list on screen reads top-to-bottom the way the map reads
// back-to-front.
export const MAP_BACKDROP_STYLE = {
  // A road is a narrow grey line over a wider pale one: the casing is what makes a road look like a road rather than a
  // scratch, and it costs one extra path.
  roads: { label: 'Roads', color: '#94a3b8', casing: '#f8fafc', width: 2, casingWidth: 5 },
  // Water is drawn as a filled shape AND as a line: a stream is a line and a lake is a shape, and both arrive in the same
  // collection.
  water: { label: 'Waterways', color: '#60a5fa', fill: '#bfdbfe', width: 2, fillOpacity: 0.7 },
  // FLOOD ZONES ARE FILLED, and the fill is what carries the meaning: this is the one layer on the map that says something
  // about the ground rather than showing where the ground is. The colour below is only the fallback - each zone is drawn in
  // FEMA's own colour for it (see floodZoneColour), which is what the county's own viewer does and what a member may have
  // seen before. The wash is light on purpose: the boundary, the roads and the pins are all read THROUGH it.
  flood: { label: 'Flood zones', color: '#1d4ed8', fill: '#3b82f6', width: 0.5, fillOpacity: 0.32 },
  // NEIGHBOURING DISTRICTS ARE OUTLINE ONLY, and dashed, which is the one drawing in this app that says "not ours": the
  // station's own district is a solid red line, and everything else is somebody else's. The faint fill is not decoration - a
  // 1.5-pixel outline is not a target a fingertip can press, and the fill is what makes the whole area tappable, so a
  // neighbouring district can be asked its name.
  districts: { label: 'Neighbouring districts', color: '#64748b', fill: '#94a3b8', width: 1.5, fillOpacity: 0.12, dash: '6 5' },
  // THE ROADS OUTSIDE OUR BAND - the arteries through the districts next door - drawn THINNER AND FAINTER than our own roads,
  // because they are context, not our responsibility: a crew reads them to know the way through and out, not to answer on them.
  // Same casing idea as our roads, just quieter, so at a glance it is obvious which streets are ours and which are somebody
  // else's. Like our roads, they carry their name (roadName / roadDetail), so tapping one still says what it is called.
  neighbourRoads: { label: 'Nearby roads', color: '#cbd5e1', casing: '#ffffff', width: 1.25, casingWidth: 3.5 },
};

// THE SAME FIVE LAYERS ON DARK GROUND. Same widths, same dashes, same labels - only the colours change, and only so the drawing
// keeps its meaning: a pale casing on near-black would blaze, so the casing goes dark and the line goes pale; the water keeps
// its blue but deepens its fill; the districts keep their grey but lift it. The flood zones are NOT here - FEMA's colours are
// facts, and an AE zone is navy in daylight and navy at night.
export const MAP_BACKDROP_STYLE_DARK = {
  roads: { label: 'Roads', color: '#cbd5e1', casing: '#1e293b', width: 2, casingWidth: 5 },
  water: { label: 'Waterways', color: '#38bdf8', fill: '#0c4a6e', width: 2, fillOpacity: 0.7 },
  flood: { label: 'Flood zones', color: '#1d4ed8', fill: '#3b82f6', width: 0.5, fillOpacity: 0.32 },
  districts: { label: 'Neighbouring districts', color: '#94a3b8', fill: '#64748b', width: 1.5, fillOpacity: 0.18, dash: '6 5' },
  neighbourRoads: { label: 'Nearby roads', color: '#94a3b8', casing: '#0f172a', width: 1.25, casingWidth: 3.5 },
};

// Which ground the map is on, as the one decision every drawn element reads: the canvas is Leaflet's own drawing, so the app's
// `dark` class never reaches it - the component picks the style table instead. Beside the style (not in the component) so the
// legend and the rendering cannot disagree, exactly as the light table already does.
export const backdropStyleFor = (dark = false) => (dark ? MAP_BACKDROP_STYLE_DARK : MAP_BACKDROP_STYLE);

// WHICH CLIP EACH LAYER IS FETCHED WITH, because it is the app's decision rather than a caller's argument: a card that had to
// remember which layer wanted which clip is a card that can get it wrong in a way nobody sees until a member is looking at a
// map that stops at the boundary.
//
//   * `district` - the district's own outline. The water is in it, and so are the flood zones.
//   * `band` - the district's outline PLUS a band of ground around it (MAP_BACKDROP_BAND_METRES). The district line runs down
//     the middle of roads and along the edge of other districts, so the roads and the districts around this one are the two
//     layers whose own subject continues past the line.
//   * `neighbourhood` - the outlines of the NEIGHBOURING districts themselves (one clip per beat), which is the one clip that
//     is not a shape around our district at all: it is their ground. See the note under neighbourRoads below for why it is not
//     simply "the band, but bigger".
export const MAP_BACKDROP_CLIP = { roads: 'band', water: 'district', flood: 'district', districts: 'band', neighbourRoads: 'neighbourhood' };

// HOW WIDE THE BAND IS: a kilometre, which is about a ninth of this district's width and comfortably more than a road's
// length on a call. It is asked for as an ENVELOPE rather than as a buffered outline, because buffering a 2,245-point polygon
// is a geometry service this app does not use and does not want - and a box around the district is a SUPERSET of the band, so
// what comes back is a little more than what is drawn. That is the honest cost: it took the roads from 398 lines clipped to the
// district alone to 1,142 inside the band (156 KB to 338 KB, both well inside a document), and it is what lets the map show the
// far side of a road and the district on the other side of a line.
export const MAP_BACKDROP_BAND_METRES = 1000;

// One degree of latitude in metres. Longitude is squeezed by the cosine of the latitude, which over a few kilometres of
// Brunswick County is within a percent - and this is a clip, so a percent is the width of a lane.
const METRES_PER_DEGREE_LATITUDE = 111320;

// THE BAND AROUND A BOX, in Leaflet's order, as a box: what services/countyGis turns into an ESRI envelope.
export const bandBounds = (bounds, metres = MAP_BACKDROP_BAND_METRES) => {
  if (!bounds) return null;
  const [[south, west], [north, east]] = bounds;
  const dLat = metres / METRES_PER_DEGREE_LATITUDE;
  const dLng = dLat / Math.cos((((south + north) / 2) * Math.PI) / 180);
  return [[south - dLat, west - dLng], [north + dLat, east + dLng]];
};

export const MAP_BACKDROP_CACHE_KEY = 'sp_district_backdrops';

// WHICH ATTRIBUTES ARE KEPT, per layer. The road layer carries forty fields, and asking for all of them tripled the payload
// (548 KB against 156) for information nothing on screen reads. FOUR of them are worth their bytes, and they are the reason
// this is a per-layer list rather than a rule: the name to draw along the road (in both spellings the county uses) and the
// department covering each side of it - which is what turns "whose district is this?" into a question the map answers. The
// water keeps none: nothing in it is drawn as text or asked about. The layers added later keep what their own drawing needs and
// no more: a flood zone needs the zone it is, a neighbouring district needs its name, and a NEIGHBOURING ROAD needs only its
// name - it is somebody else's street, so who covers each side of it (FIRELEFT/FIRERIGHT) is not a question this station asks,
// and dropping those two department-name strings is what keeps 3,000-odd neighbouring roads to 594 KB inside one document.
export const MAP_BACKDROP_FIELDS = {
  roads: ['NAME', 'FULLNAME', 'FIRELEFT', 'FIRERIGHT'],
  water: [],
  flood: ['ZONE_LID_VALUE', 'ZONESUB_LID_VALUE'],
  districts: ['AgencyID', 'DisplayName', 'Zone'],
  neighbourRoads: ['NAME', 'FULLNAME'],
};

// The words to label a road with, and the beat on each side of it. Every one of these may be empty - an unnamed lane, or a
// stretch the county has not attributed - so each answers '' rather than a placeholder that would print as a gap.
export const roadName = (properties) => String(properties?.FULLNAME || properties?.NAME || '').trim();
export const roadBeatLeft = (properties) => String(properties?.FIRELEFT || '').trim();
export const roadBeatRight = (properties) => String(properties?.FIRERIGHT || '').trim();

// WHICH ROADS ARE WORTH DRAWING IN A NEIGHBOUR'S DISTRICT: the ones fast enough to be the way THROUGH, not every driveway and
// subdivision lane. This is the app's own filter, not the county's, and it is what makes the "nearby roads" layer possible at
// all: EVERY road in every neighbouring district measured 1,404 KB - nearly twice the 900 KB a document may hold - while the
// arterials and collectors (posted 35 mph and up) are 594 KB and are exactly the roads a crew reads at district scale, where a
// hundred cul-de-sacs nobody drives to on a call would only be noise. A road the county has not posted a limit for is dropped:
// an unposted lane is by definition not an artery.
export const NEIGHBOUR_ROAD_WHERE = 'SPEEDLIMIT >= 35';

// MERGE several feature collections into ONE, dropping any feature whose geometry has already been seen. The "nearby roads"
// layer is fetched as one query per neighbouring district (services/countyGis#neighbourOutlineRings), and the roads along the
// line two neighbours SHARE come back from both clips - once for each - so they are merged and de-duplicated here rather than
// drawn twice. The key is the geometry's coordinates as text: the same source road returns identical coordinates from both
// clips, and a road that merely looks similar is kept, because dropping a real road is a hole on the map while a duplicated one
// is just a line drawn twice over itself.
export const mergeBackdropFeatures = (collections) => {
  const seen = new Set();
  const features = [];
  for (const collection of Array.isArray(collections) ? collections : []) {
    for (const feature of collection?.features || []) {
      const key = JSON.stringify(feature?.geometry?.coordinates ?? null);
      if (seen.has(key)) continue;
      seen.add(key);
      features.push(feature);
    }
  }
  return { type: 'FeatureCollection', features };
};

// One line of text for a road somebody has tapped: the name, and whose district each side is. The two sides are the same
// department along almost every road, so they are said once - and when they differ, which is a district line running down the
// middle of a road, both are named and the order says which is which.
export const roadDetail = (properties) => {
  const name = roadName(properties);
  const left = roadBeatLeft(properties);
  const right = roadBeatRight(properties);
  const beats = left === right ? left : [left, right].filter(Boolean).join(' / ');
  return [name, beats].filter(Boolean).join(' · ');
};

// FEMA'S OWN COLOURS FOR ITS ZONES, which the county's own viewer uses and a member may already have seen. The zone names are
// the county's field values, unedited - a translation table in the app would be one more thing that could disagree with the
// map in a truck.
//
// THE SHADED X IS THE OUTLIER: it is not a flood zone but the "0.2 per cent annual chance" area, and FEMA draws it yellow
// rather than blue, which is exactly the distinction a crew wants to see without reading anything.
export const FLOOD_ZONE_SHADED_X = '0.2 PCT ANNUAL CHANCE FLOOD HAZARD';
const FLOOD_ZONE_COLOURS = {
  A: '#704489',
  AE: '#003994',
  AO: '#ffaa00',
  VE: '#009f62',
  D: '#64748b',
  [FLOOD_ZONE_SHADED_X]: '#e6e600',
};

export const floodZone = (properties) => String(properties?.ZONE_LID_VALUE || '').trim();

// The colour FEMA draws that zone in. An unfamiliar value - a zone this table has never heard of, which is what a county
// redraw can produce - is drawn in the layer's own colour rather than skipped: an unlabelled blue area is a question, and a
// missing polygon is a hole nobody would notice.
export const floodZoneColour = (properties) =>
  FLOOD_ZONE_COLOURS[floodZone(properties).toUpperCase()] || MAP_BACKDROP_STYLE.flood.color;

// What a tap on a flood zone says, in the county's own words for the zone. '' for a zone with no name at all, so the caller
// draws nothing rather than an empty tooltip.
export const floodZoneDetail = (properties) => {
  const zone = floodZone(properties);
  if (!zone) return '';
  if (zone === FLOOD_ZONE_SHADED_X) return 'Shaded X — 0.2% annual chance of flooding, not a flood zone';
  const sub = String(properties?.ZONESUB_LID_VALUE || '').trim();
  return `Flood zone ${zone}${sub ? ` · ${sub}` : ''}`;
};

// A NEIGHBOURING DISTRICT in the county's own words: `DisplayName` is the beat ("SUPPLY FD BEAT 13A") and `AgencyID` the
// department that runs it. The beat is the one worth printing ON the map; the department is worth having when it is asked.
export const neighbourName = (properties) => String(properties?.DisplayName || properties?.AgencyID || '').trim();

// What a tap on one says: the beat, the department it belongs to, and its zone - which is how a member finds out who to ask
// for help by name rather than by looking in a phone book.
export const neighbourDetail = (properties) => {
  const name = neighbourName(properties);
  if (!name) return '';
  const agency = String(properties?.AgencyID || '').trim();
  const zone = String(properties?.Zone || '').trim();
  return [name, agency && agency !== name ? agency : '', zone ? `beat ${zone}` : ''].filter(Boolean).join(' · ');
};

// The geometry types a background may be made of. NOT points: a dot layer is a different feature (landmarks are that
// feature), and a background that turned out to be 30,000 addresses is not what anybody meant.
const BACKDROP_GEOMETRY_TYPES = ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

// --------------------------------------------------------------------------------------------------------------
// WHERE A ROAD'S NAME GOES, AND WHETHER IT FITS.
//
// A label is a piece of text lying on a line, so it needs three things: a place along the road, an angle to lie at, and enough
// room on screen for the letters. All three are computed here rather than in the component, because they are arithmetic over
// coordinates - which is the part that can be wrong in a way nobody notices until a name is printed upside down in the middle
// of a field, or floated off the end of a road whose points are bunched at one end.
const METRES_PER_DEGREE_LAT = 111320;

// The lines a road is made of. A MultiLineString is a road with gaps - a bridge, a break at a junction - and each part is
// measured separately so that a gap does not become a straight line across the map.
export const lineParts = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) return [geometry.coordinates];
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) return geometry.coordinates;
  return [];
};

// One segment's length, in metres. Longitude is squeezed by the cosine of the latitude, which at this scale is the whole of
// the correction a label needs.
const segmentMetres = (from, to) => {
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  const dx = (lng2 - lng1) * METRES_PER_DEGREE_LAT * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dy = (lat2 - lat1) * METRES_PER_DEGREE_LAT;
  return Math.sqrt(dx * dx + dy * dy);
};

const segmentsOf = (line) =>
  line.slice(1).map((point, index) => ({
    from: line[index],
    to: point,
    metres: segmentMetres(line[index], point),
  }));

export const lineLengthMeters = (line) => segmentsOf(line).reduce((total, segment) => total + segment.metres, 0);

// The coordinate a given distance along the line reaches, interpolated inside a segment. Everything about label placement is
// asked in DISTANCE, because that is what makes it fair on a road whose points are unevenly spaced.
const pointAtMetres = (segments, target) => {
  let travelled = 0;
  for (const segment of segments) {
    if (travelled + segment.metres >= target) {
      const along = segment.metres > 0 ? (target - travelled) / segment.metres : 0;
      return [
        segment.from[0] + (segment.to[0] - segment.from[0]) * along,
        segment.from[1] + (segment.to[1] - segment.from[1]) * along,
      ];
    }
    travelled += segment.metres;
  }
  const last = segments[segments.length - 1];
  return [last.to[0], last.to[1]];
};

// How much of the road either side of the middle decides the angle: enough to ignore a single kink where the middle lands, and
// never far enough to describe a bend the name is not on. Capped in METRES as well as in proportion, because fifteen per cent of
// a four-kilometre road is six hundred metres of somewhere else.
const LABEL_WINDOW = 0.15;
const LABEL_WINDOW_MAX_METRES = 120;

// The middle of the line BY LENGTH, and the direction the road is going there.
//
// By length rather than by vertex, because a road's points are rarely evenly spaced: the middle vertex of a road whose points
// bunch up at a junction puts the label at the junction. And by a WINDOW around that point rather than by the one segment it
// falls in, because a road that hooks exactly where its middle lands - a bend at a junction, a little spur in the county's data -
// would otherwise be labelled across its own length at eighty degrees to the road everybody sees.
export const lineLabelPlacement = (line) => {
  const segments = segmentsOf(line);
  const total = segments.reduce((sum, segment) => sum + segment.metres, 0);
  if (!segments.length || total <= 0) return null;
  // [LONGITUDE, LATITUDE] out of the arithmetic, [LATITUDE, LONGITUDE] out of this function, because Leaflet takes latlng.
  const [lng, lat] = pointAtMetres(segments, total / 2);

  // The direction, as the direction of the CHORD across the window, falling back to the local segment when the two ends of the
  // window are the same place (a line that loops back on itself) - which would give no direction at all.
  const window = Math.min(total * LABEL_WINDOW, LABEL_WINDOW_MAX_METRES);
  const [startLng, startLat] = pointAtMetres(segments, total / 2 - window);
  const [endLng, endLat] = pointAtMetres(segments, total / 2 + window);
  let dLng = endLng - startLng;
  let dLat = endLat - startLat;
  if (Math.abs(dLng) < 1e-9 && Math.abs(dLat) < 1e-9) {
    const local = segments.find((segment) => segment.metres > 0) || segments[0];
    dLng = local.to[0] - local.from[0];
    dLat = local.to[1] - local.from[1];
  }

  // THE ANGLE, IN THE ONE CONVENTION CSS UNDERSTANDS.
  //
  // A CSS rotation turns CLOCKWISE, measured from the direction the text already points - east - and the screen's y axis points
  // DOWN. Latitude therefore counts NEGATIVE: going north is going up the screen, which is anticlockwise from east, which is a
  // negative angle. Omit that minus and every name is MIRRORED about the horizontal: a road climbing to the right gets a name
  // falling to the right, crossing its own road at twice its slope. A flat road hides it, which is why it is easy to ship.
  //
  // The result is then folded into the readable half turn, [-90, 90): a name may lie along a road either way round, so it lies
  // the way that reads - never upside down, and never reading down the screen.
  let bearing = (Math.atan2(-dLat, dLng * Math.cos(lat * (Math.PI / 180))) * 180) / Math.PI;
  if (bearing >= 90) bearing -= 180;
  if (bearing < -90) bearing += 180;
  return { at: [lat, lng], bearing, metres: total };
};

// HOW MUCH ROAD A LABEL NEEDS. A name needs something like sixty pixels of road to lie on, and a pixel is a measurable number
// of metres at a given zoom and latitude - so this is arithmetic rather than a table of magic thresholds, and it is what stops
// 162 names being printed on top of each other at district scale. (Web mercator: 156,543 metres per pixel at zoom 0, halved
// per zoom, squeezed by the latitude.)
export const roadLabelMinimumMetres = (zoom, latitude = 34) => {
  const metresPerPixel = (156543.03392 * Math.cos(latitude * (Math.PI / 180))) / 2 ** Math.max(0, Number(zoom) || 0);
  return 60 * metresPerPixel;
};

// THE LABELS FOR ONE COLLECTION AT ONE ZOOM: one per NAME, on the longest stretch carrying it, and only where the road is long
// enough on screen to hold the letters.
//
// ONE PER NAME is the whole trick. The county's road layer breaks at every junction - 398 features for 162 names - so a label
// per feature would print "OLD OCEAN HWY" a dozen times along one road.
export const roadLabels = (collection, zoom, latitude = 34) => {
  const minimum = roadLabelMinimumMetres(zoom, latitude);
  const best = new Map();
  (collection?.features || []).forEach((feature) => {
    const name = roadName(feature?.properties);
    if (!name) return;
    lineParts(feature.geometry).forEach((line) => {
      const placement = lineLabelPlacement(line);
      if (!placement) return;
      const current = best.get(name);
      if (!current || current.metres < placement.metres) {
        best.set(name, { name, detail: roadDetail(feature.properties), ...placement });
      }
    });
  });
  return [...best.values()].filter((label) => label.metres >= minimum).sort((a, b) => b.metres - a.metres);
};

// Every geometry in whatever shape the caller has, WITH the attributes it arrived with. The pieces rather than the geometries,
// because a road's name is a property and dropping it here is how a labelled layer becomes an unlabelled one.
const backdropPieces = (input) => {
  const value = parsedIfText(input);
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.features)) return value.features.flatMap(backdropPieces);
  if (value.type === 'Feature') {
    return backdropPieces(value.geometry).map((piece) => ({ ...piece, properties: value.properties || {} }));
  }
  if (BACKDROP_GEOMETRY_TYPES.includes(value.type) && Array.isArray(value.coordinates)) {
    return [{ properties: {}, geometry: { type: value.type, coordinates: value.coordinates } }];
  }
  if (Array.isArray(value) && Array.isArray(value[0]) && Array.isArray(value[0][0])) {
    return [{ properties: {}, geometry: { type: 'LineString', coordinates: value } }];
  }
  return [];
};

// Every geometry in whatever shape the caller has - a FeatureCollection from the county, one Feature, a bare geometry, or
// the TEXT a document holds. A LIST, because a background is many features and the water layer is a mix of lines and shapes:
// anything that read only the first feature would draw a river and none of the lakes.
const backdropGeometries = (input) => backdropPieces(input).map((piece) => piece.geometry);

// The attributes WORTH KEEPING, and no others: the fields a layer's lines need are named per layer (MAP_BACKDROP_FIELDS), cut
// to a sane length each, and absent fields become empty strings rather than nulls - a document whose shape depends on which
// roads happen to be named is a document that is awkward to read.
const keptProperties = (properties, fields) =>
  Object.fromEntries((fields || []).map((field) => [field, String(properties?.[field] ?? '').trim().slice(0, 120)]));

// Every [lng, lat] pair anywhere inside a geometry. A WALKER rather than a per-type switch, because the shapes in one
// background range from a LineString to a MultiPolygon with holes - and a walker cannot be surprised by a shape it has not
// been told about, which is the bug a type switch always eventually has.
const eachPosition = (value, visit) => {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    visit(value);
    return;
  }
  value.forEach((entry) => eachPosition(entry, visit));
};

export const backdropPointCount = (input) => {
  let counted = 0;
  backdropGeometries(input).forEach((geometry) =>
    eachPosition(geometry.coordinates, () => {
      counted += 1;
    })
  );
  return counted;
};

// The box a background occupies, in Leaflet's order. It does not fit the view - the boundary does that - but it is stored so
// that a wrong fetch is VISIBLE: a roads layer whose box is the whole county is a clip that did not happen.
export const backdropBounds = (input) => {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  let counted = 0;
  backdropGeometries(input).forEach((geometry) =>
    eachPosition(geometry.coordinates, (position) => {
      const lng = Number(position[0]);
      const lat = Number(position[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      counted += 1;
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
    })
  );
  return counted ? [[south, west], [north, east]] : null;
};

// Every position rounded, structure untouched - the same six places as everything else in this module.
const roundPositions = (value) =>
  Array.isArray(value)
    ? typeof value[0] === 'number'
      ? [roundCoordinate(value[0]), roundCoordinate(value[1])]
      : value.map(roundPositions)
    : value;

// The collection a save would store: every geometry rounded, and the named attributes kept. Built by BOTH the check and the
// save, and NOT by one calling the other - `backdropProblem` needs the size of what a save would write, and `backdropDocument`
// needs to know there is no problem with it, so a function calling a function calling it again is a stack overflow rather
// than a shape.
const backdropCollection = (input, fields = []) => ({
  type: 'FeatureCollection',
  features: backdropPieces(input).map((piece) => ({
    type: 'Feature',
    properties: keptProperties(piece.properties, fields),
    geometry: { type: piece.geometry.type, coordinates: roundPositions(piece.geometry.coordinates) },
  })),
});

// Why a background cannot be used - an empty string when it can. Its geometry types are the permissive set (lines and
// shapes), so the refusals are about emptiness and nonsense rather than about the wrong kind of shape.
export const backdropProblem = (input, fields = []) => {
  const geometries = backdropGeometries(input);
  if (!geometries.length) {
    return 'That holds no lines or shapes to draw. A background is a line or polygon layer - roads, waterways, flood zones or districts - exported as GeoJSON.';
  }
  const broken = geometries.some((geometry) => {
    let bad = false;
    eachPosition(geometry.coordinates, (position) => {
      const lng = Number(position[0]);
      const lat = Number(position[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) bad = true;
    });
    return bad;
  });
  if (broken) {
    return 'That background has a point that is not a longitude and a latitude, or that is off the planet. Check it was exported in latitude/longitude - WGS 84, EPSG 4326 - rather than in a projected grid.';
  }
  const bytes = JSON.stringify(backdropCollection(input, fields)).length;
  if (bytes > MAP_DOCUMENT_MAX_BYTES) {
    return `That background is ${Math.round(bytes / 1024)} KB once its coordinates are rounded, which is more than the ${Math.round(MAP_DOCUMENT_MAX_BYTES / 1024)} KB a station can store. A background does not need survey detail: simplify it in a GIS system, or fetch it from the county, which generalises it on the way out.`;
  }
  return '';
};

// The document a save writes: a collection of geometry as TEXT, for the same reason the boundary is (Firestore refuses an
// array inside an array), with its counts and its box.
//
// THE ATTRIBUTES KEPT ARE THE ONES THE LAYER NAMES (`meta.fields`), and no others. For the roads that is four fields - the
// name in both spellings the county uses, and the department on each side - which cost about forty kilobytes across a district
// and buy a map where the names are on the roads and "whose district is this?" is answered by tapping one. Everything else the
// county offers (speed limits, zip codes, forty columns of addressing detail) is not stored at all: it tripled the payload, and
// nothing draws it.
export const backdropDocument = (input, meta = {}) => {
  const fields = meta.fields || [];
  if (backdropProblem(input, fields)) return null;
  const collection = backdropCollection(input, fields);
  const bounds = backdropBounds(collection);
  const text = (value, max) => String(value ?? '').trim().slice(0, max);
  return {
    geojson: JSON.stringify(collection),
    features: collection.features.length,
    points: backdropPointCount(collection),
    bounds: { south: bounds[0][0], west: bounds[0][1], north: bounds[1][0], east: bounds[1][1] },
    layer: String(meta.layer || ''),
    label: text(meta.label, 80),
    source: text(meta.source, 120),
    source_url: text(meta.source_url, 300),
    tolerance: Number(meta.tolerance) > 0 ? Number(meta.tolerance) : 0,
    fields: fields.map((field) => text(field, 40)),
  };
};

// What the SCREEN needs from a stored background: the collection Leaflet draws - attributes and all - its box, and where it
// came from.
export const backdropView = (doc) => {
  if (!doc) return null;
  const pieces = backdropPieces(doc.geojson);
  if (!pieces.length) return null;
  // Rebuilt from the pieces rather than handed back as-is: the stored text IS a collection, but a hand-edited document (or one
  // from an older build) might be a bare geometry, and Leaflet wants one shape to draw.
  const collection = {
    type: 'FeatureCollection',
    features: pieces.map((piece) => ({ type: 'Feature', properties: piece.properties, geometry: piece.geometry })),
  };
  const bounds = backdropBounds(collection);
  if (!bounds) return null;
  return {
    collection,
    bounds,
    features: Number(doc.features) > 0 ? Number(doc.features) : collection.features.length,
    points: backdropPointCount(collection),
    layer: String(doc.layer || ''),
    source: String(doc.source || ''),
    fields: Array.isArray(doc.fields) ? doc.fields.map(String) : [],
    updated_at: String(doc.updated_at || ''),
  };
};

// --------------------------------------------------------------------------------------------------------------
// Landmarks: the pins. A pin is a name, a kind, a position and an optional note - all four tiny, and the position is the
// point: a landmark kept in real coordinates survives the district being redrawn, which is the reason the boundary moved
// to real coordinates in the first place.
// --------------------------------------------------------------------------------------------------------------

// A coordinate from a form or a document, where EMPTY IS NOT ZERO. `Number(null)`, `Number(undefined)` and `Number('')` are
// all 0, and 0 is a perfectly legal latitude - so a pin nobody has placed yet would be saved at 0,0 in the Atlantic and look
// like a pin somebody placed. Everything that reads a position goes through here.
const coordinateOf = (value) =>
  value === null || value === undefined || value === '' ? Number.NaN : Number(value);

export const landmarkProblem = (input = {}) => {
  const label = String(input.label ?? '').trim();
  if (!label) {
    return 'A landmark needs a name - "Hydrant 12", "Boat ramp at the bridge" - or nobody can tell two pins apart.';
  }
  if (label.length > LANDMARK_LABEL_MAX) {
    return `That name is ${label.length} characters long, and the most a pin holds is ${LANDMARK_LABEL_MAX}.`;
  }
  const lat = coordinateOf(input.lat);
  const lng = coordinateOf(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'That landmark needs a position on the map before it can be saved.';
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return 'That landmark is off the planet: its position is not a latitude and a longitude.';
  }
  const kind = landmarkKindKey(input.kind ?? MAP_TYPE_FALLBACK_KEY);
  if (!kind) {
    return 'That landmark\'s type is not one this app can store. Pick one from the list.';
  }
  const note = String(input.note ?? '');
  if (note.length > LANDMARK_NOTE_MAX) {
    return `That note is ${note.length} characters long, and the most a pin holds is ${LANDMARK_NOTE_MAX}.`;
  }
  return '';
};

// The fields a save writes, normalised in ONE place - the form validates with this, the writer stores its answer, and the
// rule names the same field list, so a pin cannot be half-saved. null means refused, and the caller shows the reason.
export const landmarkFields = (input = {}) => {
  if (landmarkProblem(input)) return null;
  return {
    label: String(input.label).trim().slice(0, LANDMARK_LABEL_MAX),
    // The key the station's own type list gave it. Stored as given rather than looked up, because the writer has no business
    // reading another document to save a pin - see landmarkKindKey.
    kind: landmarkKindKey(input.kind ?? MAP_TYPE_FALLBACK_KEY) || MAP_TYPE_FALLBACK_KEY,
    // Rounded to the same six places as the boundary: 11 cm of the ground, which is finer than the phone that placed it.
    lat: roundCoordinate(coordinateOf(input.lat)),
    lng: roundCoordinate(coordinateOf(input.lng)),
    note: String(input.note ?? '').trim().slice(0, LANDMARK_NOTE_MAX),
  };
};

// One stored row as the screen wants it, or null. A row with no usable position is DROPPED rather than drawn: a pin with no
// coordinates would otherwise sit off the coast of Africa, where a member would find it and reasonably report a bug.
export const landmarkView = (doc) => {
  if (!doc) return null;
  const lat = coordinateOf(doc.lat);
  const lng = coordinateOf(doc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    id: String(doc.id || ''),
    label: String(doc.label || 'Landmark'),
    // Not resolved against the type list here: a view is data, and which icon a kind wears is the screen's business
    // (utils/mapTypes#mapTypeFor). This is the key the document holds, or the fallback.
    kind: landmarkKindKey(doc.kind) || MAP_TYPE_FALLBACK_KEY,
    lat,
    lng,
    note: String(doc.note || ''),
  };
};

// Every usable pin, in name order - which is the order a list beside the map reads in, and a stable one between reads.
export const sortedLandmarks = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map(landmarkView)
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label));

// --------------------------------------------------------------------------------------------------------------
// The device's copies, so the map draws with no signal.
// --------------------------------------------------------------------------------------------------------------

const cacheAvailable = () => {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch {
    return false;
  }
};

const readCache = (key) => {
  if (!cacheAvailable()) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeCache = (key, value) => {
  if (!cacheAvailable()) return false;
  try {
    // An empty value CLEARS the copy rather than storing an empty one: a boundary an officer has just removed must not
    // come back on the next visit, which is the same rule the drawing's cache keeps (utils/mapLayer).
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
      return true;
    }
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const cachedBoundary = () => readCache(MAP_BOUNDARY_CACHE_KEY);
export const cacheBoundary = (doc) => writeCache(MAP_BOUNDARY_CACHE_KEY, doc);
export const cachedLandmarks = () => {
  const rows = readCache(MAP_LANDMARK_CACHE_KEY);
  return Array.isArray(rows) ? rows : [];
};
export const cacheLandmarks = (rows) => writeCache(MAP_LANDMARK_CACHE_KEY, Array.isArray(rows) ? rows : []);

// The station's landmark types, kept on the device for the same reason the pins are: a map with no signal draws its pins from
// the cache, and a pin whose type cannot be resolved would draw as the fallback - which would look like the station's own
// colours had been forgotten.
export const cachedMapTypes = () => {
  const rows = readCache(MAP_TYPES_CACHE_KEY);
  return Array.isArray(rows) ? rows : [];
};
export const cacheMapTypes = (rows) => writeCache(MAP_TYPES_CACHE_KEY, Array.isArray(rows) ? rows : []);

// The backgrounds cache as ONE object under ONE key - `{ roads: doc|null, water: doc|null }` - because they are read together
// when the map opens, and there is no state in which half of them on the device is useful.
export const cachedBackdrops = () => {
  const value = readCache(MAP_BACKDROP_CACHE_KEY);
  return value && typeof value === 'object' ? value : {};
};

export const cacheBackdrops = (value) => writeCache(MAP_BACKDROP_CACHE_KEY, value && typeof value === 'object' ? value : null);



