/**
 * Verifies the district map: the drawing's refusals and measurements, the device copy, and the wiring that carries them.
 *
 * WHY THE REFUSALS ARE THE POINT. A drawing is stored as SVG TEXT and drawn as an image, so the two things that can go
 * wrong are quiet ones: a file accepted with scripting in it, or a file refused for a reason its owner cannot act on.
 * Neither shows up on a rendered screen - the first looks like a working map, the second like an officer who cannot
 * upload a map that opens fine in their editor. So they are asserted here, one message at a time.
 *
 * THE WIRING IS ASSERTED TOO, because this feature spans eight files and none of them fails loudly when it is missed: a
 * tab with no sidebar entry, a permission with no rule, a rule whose literal has drifted from the constant the browser
 * checks. Those are shapes a source read catches and a click-through does not.
 *
 * Run with: npm run verify:district-map
 */
import { readFileSync } from 'node:fs';
import {
  MAP_LAYER_CACHE_KEY,
  MAP_LAYER_DOC_ID,
  MAP_LAYER_MAX_BYTES,
  cacheMapLayer,
  cachedMapLayer,
  clearCachedMapLayer,
  formatBytes,
  mapLayerBounds,
  mapLayerFields,
  mapLayerIsEmpty,
  mapLayerProblem,
  mapSvgBytes,
  mapSvgProblem,
  mapSvgSize,
  mapSvgViewBox,
  svgReferenceIsExternal,
} from '../src/utils/mapLayer.js';
import { ROUTED_FEATURES, ROUTED_READS, ROUTED_WRITES } from '../src/services/firestoreRouting.js';
import { ADMIN_PERMISSIONS, MEMBER_PERMISSIONS, MEMBER_PERMISSION_GROUPS, allowedAdminTabs, roleAllowsTab, roleHasAdministration } from '../src/utils/permissions.js';
// The demo station's placeholder drawing, so the fixture and the harness cannot drift: the same validator an officer's
// upload meets is run over the thing a developer sees in the emulator.
import { DEMO_BACKDROP_GEOJSON, DEMO_BOUNDARY_GEOJSON, DEMO_BOUNDARY_META, DEMO_DISTRICT_HEIGHT, DEMO_DISTRICT_SVG, DEMO_DISTRICT_WIDTH } from './seed-emulator.mjs';
// The slimming tool's own rules, tested here rather than trusted: a rounding that changes the drawing is exactly the kind of
// thing that looks right on screen and is wrong in the file.
import { roundNumber, slimMapSvg } from './inspect-map-svg.mjs';
// The real map: the boundary polygon, the pins, and the one place that asks the county for anything.
import {
  boundaryDocument,
  boundaryGeometry,
  boundaryProblem,
  boundaryView,
  cacheBoundary,
  cachedBoundary,
  geometryBounds,
  geometryPointCount,
  landmarkFields,
  landmarkKindKey,
  landmarkProblem,
  landmarkView,
  sortedLandmarks,
} from '../src/utils/districtMap.js';
import {
  fireBeatQueryUrl,
  fireBeatSearchTerm,
  esriClipFrom,
  esriBandFrom,
  backdropQueryParams,
  neighbourWhere,
  neighbourOutlineRings,
  COUNTY_BACKDROP_TOLERANCE,
  COUNTY_FLOOD_URL,
  COUNTY_BACKDROP_SOURCE,
  COUNTY_FIRE_BEATS_LAYER,
} from '../src/services/countyGis.js';
// The station's own landmark types: the catalogue, its checks, and the icon table the map draws its markers from.
import {
  DEFAULT_MAP_TYPES,
  MAP_TYPE_COLOURS,
  mapTypeFor,
  mapTypeFields,
  mapTypeKey,
  mapTypeProblem,
  mapPinStyle,
  mapTypesDocument,
  mapTypesProblem,
  mapTypesView,
  styleDeclarations,
} from '../src/utils/mapTypes.js';
import { MAP_ICON_KEYS, iconElements } from '../src/utils/mapIcons.js';
import {
  FLOOD_ZONE_SHADED_X,
  MAP_BACKDROP_BAND_METRES,
  MAP_BACKDROP_CLIP,
  MAP_BACKDROP_FIELDS,
  MAP_BACKDROP_LAYERS,
  backdropBounds,
  backdropDocument,
  backdropPointCount,
  backdropProblem,
  backdropView,
  bandBounds,
  floodZoneColour,
  floodZoneDetail,
  lineLabelPlacement,
  lineLengthMeters,
  mergeBackdropFeatures,
  neighbourDetail,
  neighbourName,
  NEIGHBOUR_ROAD_WHERE,
  roadDetail,
  roadLabelMinimumMetres,
  roadLabels,
} from '../src/utils/districtMap.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : detail ? ` -> ${detail}` : ''}`);
};

// The drawings the checks are made of. Deliberately terse: each one is about ONE decision the validator makes.
const drawing = (inner, attributes = 'viewBox="0 0 400 300"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${inner}</svg>`;
const GOOD = drawing('<rect x="0" y="0" width="400" height="300"/>');

console.log('--- a drawing this app can store ---');
check('a plain drawing is accepted', mapSvgProblem(GOOD), '');
check('and measured from its viewBox', mapSvgSize(GOOD), { width: 400, height: 300 });
check('a width and height alone are enough', mapSvgSize('<svg width="800" height="600"></svg>'), { width: 800, height: 600 });
check('with a viewBox synthesised from them', mapSvgViewBox('<svg width="800" height="600"></svg>'), '0 0 800 600');
check(
  'an XML declaration, a doctype and a comment before the root are all fine',
  mapSvgProblem('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<!-- drawn -->\n<svg viewBox="0 0 10 10"><rect/></svg>'),
  ''
);
check('a re-used shape inside itself is fine', mapSvgProblem(drawing('<use xlink:href="#a"/><path id="a" d="M0 0"/>')), '');
check('so is an embedded image', mapSvgProblem(drawing('<image href="data:image/png;base64,AAAA"/>')), '');
check(
  'a label containing the word "on" and an equals sign is TEXT, not an attribute',
  mapSvgProblem(drawing('<text>Station on call = 4</text>')),
  ''
);
check('and commas are as legal as spaces in a viewBox', mapSvgSize('<svg viewBox="0,0,640,480"/>'), { width: 640, height: 480 });

console.log('\n--- refusals, and what each one says ---');
const problems = (svg) => mapSvgProblem(svg);
checkIs('an empty choice is named as one', problems('').includes('Choose an SVG file'), problems(''));
checkIs('a file that is not a drawing is named as one', problems('<html><body>hi</body></html>').includes('not an SVG drawing'), problems('<html>'));
checkIs('a script is refused', problems(drawing('<script>alert(1)</script>')).includes('contains a script'), 'accepted a script');
checkIs('a foreignObject is refused too', problems(drawing('<foreignObject width="10" height="10"/>')).includes('contains a script'), 'accepted a foreignObject');
checkIs('a click handler is refused', problems(drawing('<rect onclick="x()"/>')).includes('runs code'), 'accepted a click handler');
checkIs('and so is a javascript: URL in an attribute', problems(drawing('<a href="javascript:x()"><text>a</text></a>')).includes('runs code'), 'accepted javascript:');
checkIs(
  'a drawing pointing at a file outside itself is refused, because an image will not fetch it',
  problems(drawing('<image href="legend.png"/>')).includes('outside itself'),
  problems(drawing('<image href="legend.png"/>'))
);
checkIs(
  'an over-large drawing hears the cap AND its own size',
  problems(drawing('<rect/>', `viewBox="0 0 10 10" data-pad="${'x'.repeat(MAP_LAYER_MAX_BYTES)}"`)).includes(formatBytes(MAP_LAYER_MAX_BYTES)),
  'the cap was not named'
);
checkIs('a drawing with no size at all is refused', problems(drawing('<rect/>', '')).includes('does not state its size'), problems(drawing('<rect/>', '')));
checkIs(
  'a percentage width is NOT a size, because the file has not seen the box',
  problems(drawing('<rect/>', 'width="100%" height="100%"')).includes('does not state its size'),
  'a percentage was taken as pixels'
);
// The ORDER matters as much as the refusals: whoever reads the message needs the most obvious thing to do about it first.
checkIs(
  'a file that is both the wrong type and huge hears the type first',
  problems(`<html>${'x'.repeat(MAP_LAYER_MAX_BYTES)}</html>`).includes('not an SVG drawing'),
  'the size spoke before the type'
);
// Asserted on the exported predicate, rather than inferred from a message: this is the rule the refusal is built from.
check('references INSIDE the file are the only acceptable ones', [
  svgReferenceIsExternal('#area-4'),
  svgReferenceIsExternal('data:image/png;base64,AA'),
  svgReferenceIsExternal('legend.png'),
  svgReferenceIsExternal('https://example.com/x.svg'),
  svgReferenceIsExternal(''),
], [false, false, true, true, false]);

console.log('\n--- the map space, which is not the page space ---');
// An SVG counts DOWN from the top-left; a map counts UP from the bottom-left. The flip is one line and the whole difference
// between a drawing and its mirror image, so it is asserted rather than trusted.
check('the drawing is laid across the map with y flipped', mapLayerBounds({ svg: GOOD }), [[0, 0], [300, 400]]);
check('and the stored measurements are preferred to re-reading the text', mapLayerBounds({ svg: '', width: 20, height: 10 }), [[0, 0], [10, 20]]);
check('a layer that cannot be measured has no bounds', mapLayerBounds({ svg: '<svg><rect/></svg>' }), null);
check('an absent layer is EMPTY rather than broken - a station that has not drawn one yet', [mapLayerIsEmpty(null), mapLayerProblem(null)], [true, '']);
checkIs('a stored drawing that went bad is reported rather than drawn', mapLayerProblem({ svg: drawing('<script>x</script>') }).includes('contains a script'), 'not reported');

console.log('\n--- what a save writes ---');
check('a good drawing normalises to text plus its measurements', mapLayerFields(GOOD), {
  svg: GOOD,
  width: 400,
  height: 300,
  view_box: '0 0 400 300',
});
check('a refused drawing writes nothing at all', mapLayerFields(drawing('<script>x</script>')), null);
check('and bytes are counted as BYTES, not characters', mapSvgBytes('é'), 2);
check('a size a person can read', [formatBytes(512), formatBytes(2048), formatBytes(5 * 1024 * 1024)], ['512 bytes', '2 KB', '5.0 MB']);
check('the document id is one fixed name, because there is one district map', MAP_LAYER_DOC_ID, 'district');

console.log('\n--- the slimming tool, which is what a 10 MB drawing needs ---');
// Rounding is the one transformation that changes the file without changing the drawing, so it is asserted on the cases
// where a naive implementation gets it wrong: a trailing zero that need not be written, a negative that rounds to zero, and
// a negative zero, which is a number no SVG reader needs to see.
check('a coordinate rounded, and written the shortest way that means the same thing', [
  roundNumber('1823.42468261719', 1),
  roundNumber('12.0', 1),
  roundNumber('-0.04', 1),
  roundNumber('8', 2),
], ['1823.4', '12', '0', '8']);
const TRACED = '<svg viewBox="0 0 5000 5000"><!-- traced --><polygon points="10.123456,20.654321 30.111111,40.999999" fill="#fee2e2" stroke-width="1.512345"/><text x="10.5" y="20.5">Station</text></svg>';
const SLIMMED = slimMapSvg(TRACED, 1);
checkIs('the copy is smaller', mapSvgBytes(SLIMMED) < mapSvgBytes(TRACED), `${mapSvgBytes(SLIMMED)} vs ${mapSvgBytes(TRACED)}`);
checkIs('and is still a drawing the app accepts', mapSvgProblem(SLIMMED) === '', mapSvgProblem(SLIMMED));
checkIs(
  'its colours and its labels survive, because only coordinates are touched',
  /fill="#fee2e2"/.test(SLIMMED) && /<text/.test(SLIMMED) && /Station/.test(SLIMMED),
  SLIMMED
);
checkIs('its editor comments do not', !/traced/.test(SLIMMED), SLIMMED);
checkIs('and its coordinates are rounded', /points="10.1,20.7 30.1,41"/.test(SLIMMED), SLIMMED);

console.log('\n--- the demo station, which must be a drawing this app would accept ---');
// The placeholder goes through the SAME validator an officer's upload does: a fixture that quietly stopped being an
// acceptable drawing would sit in the demo station looking like a working map, which is exactly what this harness exists
// to prevent. Asserted here rather than in the seed, because the seed cannot fail - it just writes what it is given.
check('the seeded placeholder is a drawing the app accepts', mapSvgProblem(DEMO_DISTRICT_SVG), '');
check('with the measurements the map screen lays it out by', [
  mapLayerBounds({ svg: DEMO_DISTRICT_SVG, width: DEMO_DISTRICT_WIDTH, height: DEMO_DISTRICT_HEIGHT }),
  mapSvgViewBox(DEMO_DISTRICT_SVG),
], [[[0, 0], [DEMO_DISTRICT_HEIGHT, DEMO_DISTRICT_WIDTH]], `0 0 ${DEMO_DISTRICT_WIDTH} ${DEMO_DISTRICT_HEIGHT}`]);
check('and no role in the demo station holds the flag, which is a NEW station\'s state', /can_view_map: true/.test(readFileSync('scripts/seed-emulator.mjs', 'utf8')), false);
// The demo boundary goes through the SAME validator an officer's save does, and is written under the same id the app reads,
// so the fixture cannot drift into something the map screen would refuse to draw.
check('the seeded boundary is one the app accepts', boundaryProblem(DEMO_BOUNDARY_GEOJSON), '');
check('and it lands under the id the app reads', boundaryDocument(DEMO_BOUNDARY_GEOJSON, DEMO_BOUNDARY_META).bounds, {
  south: 34,
  west: -78.2,
  north: 34.1,
  east: -78.09,
});
checkIs(
  'in the collection the reader asks for',
  /put\('map_boundaries\/district'/.test(readFileSync('scripts/seed-emulator.mjs', 'utf8')),
  'the map would open on "no boundary set" in the demo station'
);
check(
  'and the seeded backgrounds are ones the app accepts',
  MAP_BACKDROP_LAYERS.map((layer) => backdropProblem(DEMO_BACKDROP_GEOJSON[layer], MAP_BACKDROP_FIELDS[layer])),
  MAP_BACKDROP_LAYERS.map(() => '')
);
// EVERY SEEDED LAYER, not just the first two: a fixture the app refuses is a demo station whose map is missing a layer, and the
// fetch that would have replaced it needs an officer to press a button they have no reason to press.
check(
  'and every one of them lands in a document the screen can draw',
  MAP_BACKDROP_LAYERS.map((layer) => {
    const doc = backdropDocument(DEMO_BACKDROP_GEOJSON[layer], { layer, fields: MAP_BACKDROP_FIELDS[layer] });
    return [doc?.layer, Number(doc?.features) > 0, backdropView(doc) !== null];
  }),
  MAP_BACKDROP_LAYERS.map((layer) => [layer, true, true])
);

console.log('\n--- the boundary, which is REAL geography ---');
// A square of a few kilometres in North Carolina, written the way the county hands one over.
const SQUARE = {
  type: 'Feature',
  properties: { DisplayName: 'TEST BEAT 7', AgencyID: 'TEST FIRE DEPARTMENT', Zone: '7' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-78.2, 34.0],
        [-78.1, 34.0],
        [-78.1, 34.1],
        [-78.2, 34.0],
      ],
    ],
  },
};
check('a feature from the county is read as a polygon', boundaryGeometry(SQUARE)?.type, 'Polygon');
check('and its points are counted', geometryPointCount(SQUARE), 4);
check('with the box the screen fits to, south-west to north-east', geometryBounds(SQUARE), [[34, -78.2], [34.1, -78.1]]);
// THE ONE LINE THAT IS EASY TO GET BACKWARDS: GeoJSON positions are [longitude, latitude], and Leaflet wants [latitude,
// longitude]. Swapped, the district lands in the Indian Ocean and still looks like a perfectly good map of somewhere.
check(
  'longitude and latitude are never swapped',
  geometryBounds({ type: 'Polygon', coordinates: [[[0, 10], [1, 10], [1, 11]]] }),
  [[10, 0], [11, 1]]
);
check('a bare list of rings is read too', boundaryGeometry([[[0, 0], [1, 0], [1, 1]]])?.type, 'Polygon');
check('and a FeatureCollection takes its first feature', boundaryGeometry({ type: 'FeatureCollection', features: [SQUARE] })?.type, 'Polygon');

console.log('\n--- what a boundary save writes ---');
check('the geometry is stored as TEXT, because Firestore cannot nest an array', typeof boundaryDocument(SQUARE, {}).geojson, 'string');
check('with its box as a flat map of four numbers', boundaryDocument(SQUARE, {}).bounds, {
  south: 34,
  west: -78.2,
  north: 34.1,
  east: -78.1,
});
check('and the county\'s own words for whose line it is', boundaryDocument(SQUARE, { label: 'TEST BEAT 7', zone: '7', agency: 'TEST FIRE DEPARTMENT' }).label, 'TEST BEAT 7');
check(
  'coordinates are rounded to six places on the way in - about 11 cm, finer than the line is drawn',
  JSON.parse(
    boundaryDocument({ type: 'Polygon', coordinates: [[[-78.12345678, 34.98765432], [-78.1, 34.9], [-78.2, 34.99]]] }, {}).geojson
  ).coordinates[0][0],
  [-78.123457, 34.987654]
);
checkIs(
  'a file that is not a boundary is refused with something to do about it',
  boundaryProblem({ type: 'Point', coordinates: [1, 2] }).includes('does not hold a district boundary'),
  boundaryProblem({ type: 'Point', coordinates: [1, 2] })
);
checkIs('a ring of two points is refused', boundaryProblem({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }).includes('at least three'), 'not refused');
checkIs(
  'a point off the planet is refused, and the message says which grid to export in',
  boundaryProblem({ type: 'Polygon', coordinates: [[[-78, 34], [-78, 95], [-77, 34]]] }).includes('EPSG 4326'),
  'not refused'
);
check(
  'the screen gets a geometry to draw and a box to fit',
  (() => {
    const view = boundaryView(boundaryDocument(SQUARE, {}));
    return [view.geometry.type, view.bounds, view.points];
  })(),
  ['Polygon', [[34, -78.2], [34.1, -78.1]], 4]
);

console.log('\n--- the pins ---');
check('a pin normalises to five fields, trimmed and rounded', landmarkFields({ label: '  Hydrant 12 ', kind: 'hydrant', lat: 34.12345678, lng: -78.98765432, note: ' x ' }), {
  label: 'Hydrant 12',
  kind: 'hydrant',
  lat: 34.123457,
  lng: -78.987654,
  note: 'x',
});
checkIs('a pin with no name is refused', landmarkProblem({ lat: 1, lng: 1 }).includes('needs a name'), 'not refused');
checkIs('a pin with no position is refused', landmarkProblem({ label: 'X' }).includes('needs a position'), 'not refused');
// THE BUG THIS GUARD EXISTS FOR: `Number(null)` is 0, and 0 is a legal latitude - so a pin nobody had placed yet saved at 0,0
// in the Atlantic and looked exactly like a pin somebody had placed. Empty is not zero.
checkIs(
  'an EMPTY position is refused rather than saved at zero',
  landmarkProblem({ label: 'X', lat: null, lng: null }).includes('needs a position'),
  landmarkProblem({ label: 'X', lat: null, lng: null })
);
check('and nothing is written for one', landmarkFields({ label: 'X', lat: null, lng: null }), null);
check('a stored row with an empty position is dropped rather than drawn', landmarkView({ id: 'c', label: 'C', lat: null, lng: null }), null);
check('while a real zero is a place somebody might be', landmarkFields({ label: 'X', kind: 'other', lat: 0, lng: 0 }).lat, 0);
checkIs('a pin off the planet is refused', landmarkProblem({ label: 'X', lat: 91, lng: 0 }).includes('off the planet'), 'not refused');
checkIs('a note nobody will read is refused', landmarkProblem({ label: 'X', lat: 1, lng: 1, note: 'x'.repeat(281) }).includes('281 characters'), 'not refused');
// A KIND IS NOW THE STATION'S OWN TYPE LIST, so this module bounds it rather than enumerating it: a key that could not have come
// from the picker is refused, and one that is simply not in today's list still saves - the map resolves it to the fallback type
// (utils/mapTypes#mapTypeFor) rather than losing the pin.
check('a kind that is not a usable key is refused', landmarkKindKey('Not A Key!'), '');
check('and a pin with one is refused too', landmarkProblem({ label: 'X', lat: 1, lng: 1, kind: 'Nope!' }).includes('not one this app can store'), true);
check('while a key the station has not got still saves', landmarkFields({ label: 'X', kind: 'dry-hydrant', lat: 1, lng: 1 }).kind, 'dry-hydrant');
check('a pin with no kind at all falls back', landmarkFields({ label: 'X', lat: 1, lng: 1 }).kind, 'other');
check('a stored row with no usable position is DROPPED, not drawn at zero', [
  landmarkView({ id: 'a', label: 'A', lat: 0, lng: 0 }).lat,
  landmarkView({ id: 'b', label: 'B' }),
], [0, null]);
check('and the list comes back in name order', sortedLandmarks([
  { id: '1', label: 'Zebra', lat: 1, lng: 1 },
  { id: '2', label: 'Apple', lat: 2, lng: 2 },
]).map((pin) => pin.label), ['Apple', 'Zebra']);

console.log('\n--- asking the county, and only when an officer presses the button ---');
check('a department\'s own name becomes a search term', fireBeatSearchTerm('Bolivia Volunteer Fire Department'), 'Bolivia');
check('a name with no place in it searches for nothing, so somebody types one', fireBeatSearchTerm('Volunteer Fire Department'), '');
check('the query asks for latitude and longitude, not the state plane feet the county stores', /outSR=4326/.test(fireBeatQueryUrl({ search: 'Bolivia' })), true);
check('and for GeoJSON, which is the shape the app stores', /f=geojson/.test(fireBeatQueryUrl({ search: 'Bolivia' })), true);
checkIs(
  'the search is a LIKE over the agency name, uppercased',
  fireBeatQueryUrl({ search: 'bolivia' }).includes('where=UPPER%28AgencyID%29+LIKE+%27%25BOLIVIA%25%27'),
  fireBeatQueryUrl({ search: 'bolivia' })
);
// A department called O'Brien must not close the SQL literal and change the question - which the county would answer with an
// error nobody can act on, or worse, with somebody else's beat.
checkIs('a quote in a department name is escaped, not pasted in', fireBeatQueryUrl({ search: "O'Brien" }).includes('%25O%27%27BRIEN%25'), fireBeatQueryUrl({ search: "O'Brien" }));
checkIs('and an empty search asks for every beat rather than for none', fireBeatQueryUrl({ search: '' }).includes('where=1%3D1'), fireBeatQueryUrl({ search: '' }));

console.log('\n--- the background: the roads and the water ---');
// A line and a lake in one collection, which is what the water layer actually is: the county keeps streams and water bodies in
// two layers, and they arrive merged so the app stores and toggles ONE thing.
const BACKDROP = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { NAME: 'HWY 421' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-78.2, 34.0],
          [-78.19, 34.01],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-78.18, 34.0],
            [-78.17, 34.0],
            [-78.17, 34.01],
            [-78.18, 34.0],
          ],
        ],
      },
    },
  ],
};
// EVERY FEATURE, not just the first: the bug this guards is a reader that takes one geometry, which would draw a river and
// none of the lakes - and look entirely plausible doing it.
check('every feature is counted, not just the first', backdropPointCount(BACKDROP), 6);
check(
  'a line and a shape can live in one collection',
  backdropView(backdropDocument(BACKDROP, { layer: 'water' })).collection.features.map((f) => f.geometry.type),
  ['LineString', 'Polygon']
);
check('and the box covers both', backdropBounds(BACKDROP), [
  [34, -78.2],
  [34.01, -78.17],
]);
check(
  'the stored document is text with its counts',
  (() => {
    const doc = backdropDocument(BACKDROP, { layer: 'roads', label: 'Roads', tolerance: 0.00001 });
    return [typeof doc.geojson, doc.features, doc.points, doc.layer, doc.tolerance];
  })(),
  ['string', 2, 6, 'roads', 0.00001]
);
checkIs(
  'the features\' own ATTRIBUTES are not stored - a background is drawn, not queried',
  !/HWY 421/.test(backdropDocument(BACKDROP, {}).geojson),
  'a road name is in the payload'
);
checkIs('a bag of points is refused', backdropProblem({ type: 'Point', coordinates: [1, 2] }).includes('no lines or shapes'), backdropProblem({ type: 'Point', coordinates: [1, 2] }));
checkIs('an empty background is refused with something to do', backdropProblem({}).includes('no lines or shapes'), backdropProblem({}));
checkIs('and one off the planet is refused', backdropProblem({ type: 'LineString', coordinates: [[-78, 91], [-77, 34]] }).includes('off the planet'), 'not refused');
check('an absent background is null rather than a fault', backdropView(null), null);
// FIVE LAYERS NOW, and the ids are the document ids: roads and water inside the district, the FEMA flood zones inside it, the
// fire districts around it, and the MAJOR roads out there. The order is the chip order and the drawing order, so it is pinned as
// well as the contents.
check('there are exactly five layers, because the document id IS the layer', MAP_BACKDROP_LAYERS, ['roads', 'water', 'flood', 'districts', 'neighbourRoads']);
check('and each layer keeps its own attributes and no others', MAP_BACKDROP_FIELDS, {
  roads: ['NAME', 'FULLNAME', 'FIRELEFT', 'FIRERIGHT'],
  water: [],
  flood: ['ZONE_LID_VALUE', 'ZONESUB_LID_VALUE'],
  districts: ['AgencyID', 'DisplayName', 'Zone'],
  // A NEIGHBOURING ROAD needs only its name: it is somebody else's street, so who covers each side of it is not a question this
  // station asks - and dropping FIRELEFT/FIRERIGHT is what keeps ~3,000 neighbouring roads to 594 KB in one document.
  neighbourRoads: ['NAME', 'FULLNAME'],
});
// WHICH LAYER IS CLIPPED TO WHICH SHAPE. The flood zones and water are wanted for this district; the roads and the districts
// around it are wanted past the district line; the neighbouring ROADS are wanted across the neighbours' OWN outlines, which is
// the one clip that is their ground rather than a shape around ours.
check('the flood zones and water are clipped to the district, roads and districts to a band, and neighbour roads to their own ground', MAP_BACKDROP_CLIP, {
  roads: 'band',
  water: 'district',
  flood: 'district',
  districts: 'band',
  neighbourRoads: 'neighbourhood',
});

console.log('\n--- the band around the district, which two layers are fetched with ---');
// THE BAND IS A BOX, and the arithmetic is the cosine: one degree of longitude is shorter than one of latitude, so the same
// number of metres is MORE degrees of longitude. Getting that the wrong way round would clip a band that is a kilometre wide
// north-to-south and eight hundred east-to-west, which nothing would ever look wrong about.
const BAND = bandBounds([[34.0, -78.2], [34.1, -78.08]], MAP_BACKDROP_BAND_METRES);
check('the band contains the district it wraps', BAND[0][0] < 34.0 && BAND[1][0] > 34.1 && BAND[0][1] < -78.2 && BAND[1][1] > -78.08, true);
check('a kilometre of latitude is 0.009 degrees', Number((34.0 - BAND[0][0]).toFixed(4)), 0.009);
check('and a kilometre of longitude is MORE degrees, because the lines of longitude crowd together going north', BAND[0][1] < -78.2 - 0.009, true);
check('a missing box has no band', bandBounds(null), null);
const ENVELOPE = esriBandFrom({ type: 'Polygon', coordinates: [[[-78.2, 34.0], [-78.08, 34.0], [-78.08, 34.1], [-78.2, 34.1], [-78.2, 34.0]]] }, MAP_BACKDROP_BAND_METRES);
check('and the band reaches the county as an ESRI ENVELOPE in lat/lng', [ENVELOPE.spatialReference.wkid, typeof ENVELOPE.xmin], [4326, 'number']);
check('which is bigger than the district on every side', ENVELOPE.xmin < -78.2 && ENVELOPE.ymin < 34.0 && ENVELOPE.xmax > -78.08 && ENVELOPE.ymax > 34.1, true);
check('and a boundary that is not a polygon has no band either', esriBandFrom({ type: 'Point', coordinates: [1, 2] }, 1000), null);

console.log('\n--- FEMA\'s colours, and who is next door ---');
// THE ZONE DECIDES THE COLOUR, which is the only place on this map where a colour carries a fact rather than an identity. The
// two worth pinning are the shaded X - drawn YELLOW, because it is not a flood zone and a member should be able to tell without
// reading anything - and an unknown zone, which must still be drawn rather than skipped.
check('an AE zone is drawn in the navy FEMA uses', floodZoneColour({ ZONE_LID_VALUE: 'AE' }), '#003994');
check('the shaded-X area is YELLOW, because it is not a flood zone', floodZoneColour({ ZONE_LID_VALUE: FLOOD_ZONE_SHADED_X }), '#e6e600');
check('a zone this build has never heard of still gets the layer colour rather than being skipped', floodZoneColour({ ZONE_LID_VALUE: 'ZZ' }), '#1d4ed8');
check('and a zone with no name at all still gets one', floodZoneColour({}), '#1d4ed8');
check('a zone says what it is when it is tapped', floodZoneDetail({ ZONE_LID_VALUE: 'AE', ZONESUB_LID_VALUE: '1000' }), 'Flood zone AE · 1000');
check('the shaded X is explained rather than printed as a code', floodZoneDetail({ ZONE_LID_VALUE: FLOOD_ZONE_SHADED_X }).includes('not a flood zone'), true);
check('and a feature with no zone has nothing to say', floodZoneDetail({}), '');
// WHO IS NEXT DOOR: the county's own name for the beat, and the department behind it.
check('a neighbouring district is labelled with the county\'s name for the beat', neighbourName({ AgencyID: 'SUPPLY FIRE DEPARTMENT', DisplayName: 'SUPPLY FD BEAT 13A' }), 'SUPPLY FD BEAT 13A');
check('and falls back to the department when the beat has no name', neighbourName({ AgencyID: 'SUPPLY FIRE DEPARTMENT' }), 'SUPPLY FIRE DEPARTMENT');
check('a tap on one names the beat and the department', neighbourDetail({ AgencyID: 'SUPPLY FIRE DEPARTMENT', DisplayName: 'SUPPLY FD BEAT 13A', Zone: '13A' }), 'SUPPLY FD BEAT 13A · SUPPLY FIRE DEPARTMENT · beat 13A');
check('and an unnamed feature has nothing to draw', [neighbourName({}), neighbourDetail({})], ['', '']);

console.log('\n--- what a pin can be: the station\'s own landmark types ---');
// THE TYPES: a station-defined list of what its pins can be. Kept in their own module (utils/mapTypes), because they are a
// DOCUMENT the station edits rather than a list the app ships - and the checks below are the ones that decide whether a list can
// be stored at all.
check('the built-in eight still carry the keys landmarks already store', DEFAULT_MAP_TYPES.map((type) => type.key), [
  'hydrant', 'water', 'ramp', 'staging', 'access', 'hazard', 'station', 'other',
]);
checkIs(
  'every built-in type has a name, one of the icons this app draws, and one of the palette colours',
  DEFAULT_MAP_TYPES.every((type) => type.label && MAP_ICON_KEYS.includes(type.icon) && MAP_TYPE_COLOURS.includes(type.color)),
  DEFAULT_MAP_TYPES.filter((type) => !MAP_ICON_KEYS.includes(type.icon) || !MAP_TYPE_COLOURS.includes(type.color))
    .map((type) => type.key)
    .join(', ')
);
check('and every one of the old colours is still in the palette, so no pin changes color', [
  '#dc2626', '#0284c7', '#0e7490', '#7c3aed', '#a16207', '#ea580c', '#15803d', '#475569',
].filter((color) => !MAP_TYPE_COLOURS.includes(color)), []);
check('the icons are a curated set rather than all of lucide', MAP_ICON_KEYS.length >= 20 && MAP_ICON_KEYS.length <= 60, true);
checkIs('and every one of them draws at least one element', MAP_ICON_KEYS.every((key) => iconElements(key).length > 0));
check('an icon this build does not have falls back to the generic pin', iconElements('banana'), iconElements('map-pin'));

// THE VALIDATION, which the card and the writer share - so a list the card accepts cannot be refused by the save.
check('a nameless type is refused', mapTypeProblem({ key: 'a', label: '', icon: 'flag', color: '#dc2626' }).includes('needs a name'), true);
check('an icon this app cannot draw is refused', mapTypeProblem({ label: 'X', icon: 'banana', color: '#dc2626' }).includes('not one of the icons'), true);
check('a color outside the palette is refused', mapTypeProblem({ label: 'X', icon: 'flag', color: '#123456' }).includes('colours from the list'), true);
check('an empty list is refused', mapTypesProblem([]).includes('at least one type'), true);
check('and a list longer than a legend holds is refused', mapTypesProblem(new Array(25).fill({ label: 'X', icon: 'flag', color: '#dc2626' })).includes('more than the 24'), true);
check('two types with the same name are refused', mapTypeProblem({ label: 'Hydrant', icon: 'flag', color: '#dc2626' }, DEFAULT_MAP_TYPES).includes('already a type called'), true);
check('and two with the same key are refused', mapTypeProblem({ key: 'hydrant', label: 'Other thing', icon: 'flag', color: '#dc2626' }, DEFAULT_MAP_TYPES).includes('share an internal key'), true);
check('a sound list passes', mapTypesProblem(DEFAULT_MAP_TYPES), '');

// A KEY IS MADE ONCE AND NOT FROM THE NAME AGAIN, which is the whole reason renaming a type cannot repaint a station's pins.
check('a key is made from the name', mapTypeKey('Dry hydrant', []), 'dry-hydrant');
check('a second type of the same name gets its own key', mapTypeKey('Dry hydrant', [{ key: 'dry-hydrant' }]), 'dry-hydrant-2');
check('and a name with nothing usable in it still yields a key', mapTypeKey('!!!', []), 'type');
checkIs(
  'renaming keeps the key, so the pins already wearing it are untouched',
  mapTypeFields({ key: 'hydrant', label: 'Fire hydrant', icon: 'droplet', color: '#dc2626' }).key === 'hydrant'
);

// WHAT THE SCREEN RESOLVES A PIN'S KIND TO, including the pin whose type was removed.
check('a pin wears the type it names', mapTypeFor(DEFAULT_MAP_TYPES, 'water').label, 'Water source');
check('a pin whose type is gone wears the fallback', mapTypeFor(DEFAULT_MAP_TYPES, 'gone').key, 'other');
check('and a station with no list at all still draws its pins', mapTypeFor([], 'hydrant').key, 'hydrant');
check('a station that removed the fallback type still gets something', mapTypeFor([{ key: 'a', label: 'A', icon: 'flag', color: '#dc2626' }], 'gone').key, 'a');

// STORED AND READ BACK. An absent or unusable document means the built-in eight - a state a screen can draw, rather than an
// error a station has to fix before it can see its own map.
const typeDoc = mapTypesDocument(DEFAULT_MAP_TYPES, { author: 'officer' });
check('the document holds the list and its count', [Array.isArray(typeDoc.types), typeDoc.count], [true, 8]);
check('and it says who last set it', typeDoc.updated_by, 'officer');
check('a document nobody has written reads as the built-in eight', mapTypesView(null), DEFAULT_MAP_TYPES);
check('and so does one somebody edited into nonsense', mapTypesView({ types: [{ label: '', icon: 'nope', color: 'red' }] }), DEFAULT_MAP_TYPES);
check('a stored list comes back as it was saved', mapTypesView(typeDoc).map((type) => `${type.key}:${type.icon}:${type.color}`)[0], 'hydrant:droplet:#dc2626');
console.log('\n--- the road names, and the beat on each side of the road ---');
// Two named roads and one short lane: the arithmetic below is about lengths and bearings, so the fixture is built so those are
// checkable by hand - an east-west road, a north-south one, and a short one that should not be labelled until somebody zooms in.
const ROADS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { NAME: 'OCEAN HWY E', FIRELEFT: 'Bolivia FD', FIRERIGHT: 'Bolivia FD' },
      geometry: { type: 'LineString', coordinates: [[-78.2, 34.0], [-78.09, 34.0]] },
    },
    {
      type: 'Feature',
      properties: { NAME: 'GEORGE II HWY', FIRELEFT: 'Winnabow FD', FIRERIGHT: 'Bolivia FD' },
      geometry: { type: 'LineString', coordinates: [[-78.12, 34.0], [-78.12, 34.06]] },
    },
    {
      type: 'Feature',
      properties: { NAME: 'SHORT LN', FIRELEFT: 'Bolivia FD', FIRERIGHT: 'Bolivia FD' },
      geometry: { type: 'LineString', coordinates: [[-78.2, 34.02], [-78.19, 34.02]] },
    },
    // A SECOND stretch of the first road's name, which is what the county actually hands over: a road broken at every junction.
    {
      type: 'Feature',
      properties: { NAME: 'OCEAN HWY E', FIRELEFT: 'Bolivia FD', FIRERIGHT: 'Bolivia FD' },
      geometry: { type: 'LineString', coordinates: [[-78.19, 34.0], [-78.185, 34.0]] },
    },
  ],
};
check('a tapped road says its name', roadDetail(ROADS.features[0].properties), 'OCEAN HWY E · Bolivia FD');
check(
  'and when a district line runs down it, BOTH sides are named',
  roadDetail(ROADS.features[1].properties),
  'GEORGE II HWY · Winnabow FD / Bolivia FD'
);
check('an unnamed lane says nothing rather than a placeholder', roadDetail({}), '');
check('the same beat on both sides is said once', roadDetail(ROADS.features[2].properties), 'SHORT LN · Bolivia FD');

// THE ARITHMETIC, checked against numbers that can be worked out by hand: 0.11 degrees of longitude at this latitude is about
// 10.2 km, and an east-west line's bearing is zero.
check('a line is measured in metres', Math.round(lineLengthMeters(ROADS.features[0].geometry.coordinates) / 100) * 100, 10200);
check('a label sits at the middle of the line', lineLabelPlacement(ROADS.features[0].geometry.coordinates).at[0], 34);
check('an east-west road lies flat', Math.round(lineLabelPlacement(ROADS.features[0].geometry.coordinates).bearing), 0);
// THE SIGN OF THIS IS THE WHOLE BUG THAT SHIPPED ONCE: CSS turns clockwise from east and the screen's y axis points down, so a
// road climbing to the right is a NEGATIVE angle. Getting it the wrong way round mirrors every name about the horizontal, and a
// flat road hides it - 102 of 104 labelled roads in the first release were drawn across their own road instead of along it.
check('a road climbing to the right is a NEGATIVE angle, because CSS turns clockwise', (() => {
  const climbing = lineLabelPlacement([[-78.2, 34.0], [-78.1, 34.08]]).bearing;
  const falling = lineLabelPlacement([[-78.2, 34.08], [-78.1, 34.0]]).bearing;
  return [climbing < 0, falling > 0];
})(), [true, true]);
// A line that is 45 degrees in DEGREES is steeper than 45 on screen, because a degree of longitude is squeezed by the cosine of
// the latitude - which is exactly the correction the bearing applies.
check('a line climbing 45 degrees of latitude and longitude is labelled steeper, because longitude is squeezed', Math.round(lineLabelPlacement([[-78.2, 34.0], [-78.175, 34.025]]).bearing), -50);
check('and it is the same angle whichever way the line was digitised', (() => {
  const up = lineLabelPlacement([[-78.2, 34.0], [-78.1, 34.08]]).bearing;
  const down = lineLabelPlacement([[-78.1, 34.08], [-78.2, 34.0]]).bearing;
  return Math.abs(up - down) < 0.001;
})(), true);
// Verticals fold into the READABLE side of the half turn, so a north-south road's name reads up the screen rather than down it.
check('a road running north lies on its side, reading upward', Math.round(lineLabelPlacement(ROADS.features[1].geometry.coordinates).bearing), -90);
check('and so does one running south', Math.round(lineLabelPlacement([[-78.12, 34.06], [-78.12, 34.0]]).bearing), -90);
check('no label is ever upside down', roadLabels(ROADS, 15, 34).every((label) => label.bearing >= -90 && label.bearing < 90), true);

// ONE PER NAME, ON THE LONGEST STRETCH: the county breaks a road at every junction, so a label per feature would print the same
// name along one road a dozen times.
const labels = roadLabels(ROADS, 15, 34);
check('one label per name, not one per stretch', labels.filter((label) => label.name === 'OCEAN HWY E').length, 1);
check(
  'on the longest stretch carrying it',
  Math.round(labels.find((label) => label.name === 'OCEAN HWY E').metres / 100) * 100,
  10200
);
// How much road a label needs is arithmetic rather than a taste: sixty pixels of road, and a pixel is a measurable number of
// metres. So the short lane is unlabelled until somebody zooms in far enough for it to hold its own name.
check('a name with no room is left off', roadLabels(ROADS, 11, 34).map((label) => label.name), ['OCEAN HWY E', 'GEORGE II HWY']);
check('and appears when the zoom gives it room', roadLabels(ROADS, 15, 34).map((label) => label.name).includes('SHORT LN'), true);
check(
  'the road a label needs halves with each step of zoom',
  Math.round(roadLabelMinimumMetres(13, 34) / roadLabelMinimumMetres(14, 34)),
  2
);

// THE FIELDS. A road's name and its beats are the three things worth their bytes; the county's other forty columns are not.
const KEPT = backdropDocument(ROADS, { layer: 'roads', fields: MAP_BACKDROP_FIELDS.roads });
check('the road layer keeps the fields it names', KEPT.fields, ['NAME', 'FULLNAME', 'FIRELEFT', 'FIRERIGHT']);
check('and the water layer keeps none', backdropDocument(BACKDROP, { layer: 'water', fields: MAP_BACKDROP_FIELDS.water }).fields, []);
check('with an alignment field that was not asked for left out', (() => { const kept = backdropDocument(ROADS, { fields: ['NAME'] }); return [kept.fields, /FIRELEFT/.test(kept.geojson)]; })(), [['NAME'], false]);
checkIs('the names reach the document', /OCEAN HWY E/.test(KEPT.geojson), 'the name was stripped');
checkIs('and the beats do too', /Winnabow FD/.test(KEPT.geojson), 'the beat was stripped');
checkIs('while an attribute nobody named does not', !/SHAPE\.STLength/.test(KEPT.geojson), 'an unasked-for field was kept');
check('the screen gets the attributes back with the geometry', backdropView(KEPT).collection.features[0].properties.NAME, 'OCEAN HWY E');
check('an older document with no fields list still draws', backdropView({ geojson: JSON.stringify(ROADS), features: 4, points: 6 }).features, 4);

console.log('\n--- and the county query that fills them ---');
// THE CLIP IS ESRI RINGS, not GeoJSON: handing that endpoint a GeoJSON polygon on the first attempt was a 400 with an empty
// error message, and the shape is the only thing that was wrong with it.
const CLIP = esriClipFrom(SQUARE);
check('the clip is rings in lat/lng', [Array.isArray(CLIP.rings), CLIP.spatialReference.wkid], [true, 4326]);
check('carrying the district outline', CLIP.rings[0].length, 4);
check('and a boundary that is not a polygon has no clip at all', esriClipFrom({ type: 'Point', coordinates: [1, 2] }), null);
const PARAMS = backdropQueryParams({ clip: CLIP, tolerance: 0.00005 });
check('no attribute fields are asked for', PARAMS.get('outFields'), '');
check('the answer is GeoJSON in lat/lng', [PARAMS.get('f'), PARAMS.get('outSR')], ['geojson', '4326']);
check('the query CLIPS rather than fetching the county', [PARAMS.get('geometryType'), PARAMS.get('spatialRel')], ['esriGeometryPolygon', 'esriSpatialRelIntersects']);
check('and it carries the tolerance that does most of the work', PARAMS.get('maxAllowableOffset'), '0.00005');
check('while no tolerance asks for none', backdropQueryParams({ clip: CLIP, tolerance: 0 }).get('maxAllowableOffset'), null);
// The two tolerances, with the reasoning pinned: a road's corners are visible from a street and a shoreline's are not, which
// is why the water is generalised five times as coarsely - and where most of the saving is.
check('roads are generalised more finely than water', COUNTY_BACKDROP_TOLERANCE.roads < COUNTY_BACKDROP_TOLERANCE.water, true);
check('about a metre, and about five', [COUNTY_BACKDROP_TOLERANCE.roads, COUNTY_BACKDROP_TOLERANCE.water], [0.00001, 0.00005]);
// THE TWO LAYERS ADDED LATER, with the numbers the fetch was measured at: a fire beat's line runs down roads, so it is
// generalised like a road's; the flood zones are 1.4 MB of shoreline-accurate FEMA polygons inside one district, and 22 m -
// a fifth of a pixel at this scale - takes the 99 polygons that fall inside the district down to 80 KB.
check('a neighbouring district is generalised like the road it runs along', COUNTY_BACKDROP_TOLERANCE.districts, 0.00005);
check('and the flood zones far more coarsely, because that is where their megabytes are', [COUNTY_BACKDROP_TOLERANCE.flood, COUNTY_BACKDROP_TOLERANCE.flood > COUNTY_BACKDROP_TOLERANCE.water], [0.0002, true]);
check('the flood layer is the county\'s FEMA service, which is what it is credited as', [COUNTY_FLOOD_URL.endsWith('Layers/FloodHazards/MapServer/0'), COUNTY_BACKDROP_SOURCE.flood.includes('FEMA')], [true, true]);
// THE BAND LAYER'S QUERY IS THE BOUNDARY'S OWN LAYER - one service, two questions - so its URL is the layer's, WITHOUT the
// `/query` the boundary search carries (services/countyGis appends that itself).
check('the neighbours come from the same layer as the boundary, asked a different question', [COUNTY_FIRE_BEATS_LAYER.endsWith('/FireBeats/FeatureServer/0'), /\/query$/.test(COUNTY_FIRE_BEATS_LAYER)], [true, false]);
check('and are credited to the people who publish this station\'s boundary', COUNTY_BACKDROP_SOURCE.districts, 'Brunswick County GIS — Brunsco_Ops/FireBeats');
// WHO IS LEFT OUT: this station. The county does the filtering, so the app does not download its own beat twice - and a quote
// in a department's name is escaped rather than closing the SQL literal.
check('the station\'s own department is excluded in the query itself', neighbourWhere('Bolivia Fire Department'), "UPPER(AgencyID) <> 'BOLIVIA FIRE DEPARTMENT'");
check('with a quote escaped rather than pasted into the query', neighbourWhere("O'Brien FD"), "UPPER(AgencyID) <> 'O''BRIEN FD'");
check('and a boundary with no agency asks for every beat, because there is nothing to match', neighbourWhere(''), '1=1');
check('the envelope is what the county is told it is sending', (() => { const params = backdropQueryParams({ clip: ENVELOPE, geometryType: 'esriGeometryEnvelope', where: neighbourWhere('X FD') }); return [params.get('geometryType'), params.get('where')]; })(), ['esriGeometryEnvelope', "UPPER(AgencyID) <> 'X FD'"]);
// THE NEARBY ROADS, which are a fetch of their own rather than a bigger band, for two reasons that were measured: a box
// around every neighbour returns more roads than the county will send in one answer (it caps a layer at 2,000 records and
// truncates silently), and a multi-ring clip is read as holes rather than a union. So the roads are fetched per neighbouring
// outline and stitched back together here - and only the ARTERIALS come back, which is what fits and what a district map reads.
check('the nearby roads are the major roads only, which is a filter of ours not a different service', NEIGHBOUR_ROAD_WHERE, 'SPEEDLIMIT >= 35');
// ONE CLIP PER NEIGHBOUR, as that beat's OUTER ring(s): the interior rings are holes and would punch a gap in the clip.
check('each neighbouring outline becomes its own ESRI clip, outer rings only', (() => {
  const clip = neighbourOutlineRings({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]], [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.2]]] } }] });
  return [clip.length, clip[0].rings.length, clip[0].rings[0].length, clip[0].spatialReference.wkid];
})(), [1, 1, 4, 4326]);
check('and a MultiPolygon yields one clip per polygon', neighbourOutlineRings({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[2, 2], [3, 2], [3, 3], [2, 2]]]] } }] }).length, 2);
check('while an empty answer has no outlines to clip', neighbourOutlineRings({ type: 'FeatureCollection', features: [] }), []);
// THE DEGENERATE-RING GUARD, which is the fix for "Failed to execute query": a county-generalised sliver can collapse to a
// ring that is four identical points, and handing that to the county as a clip is a 400 with an empty message. A ring is kept
// only if it closes AND carries at least three DISTINCT corners - the fewest that make an actual triangle.
check('a ring collapsed to one repeated corner (a sliver) is dropped, not sent as a clip', (() => {
  const collapsed = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]] } }] };
  return neighbourOutlineRings(collapsed).length;
})(), 0);
check('as is a ring with only two distinct corners - a line wearing a polygon\'s clothes', (() => {
  const line = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0], [0, 0]]] } }] };
  return neighbourOutlineRings(line).length;
})(), 0);
check('while a real triangle - three distinct corners - is kept as a clip', (() => {
  const triangle = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0.5, 1], [0, 0]]] } }] };
  return neighbourOutlineRings(triangle).length;
})(), 1);
// MERGE: the seams where two neighbours meet come back twice, and the merge drops the duplicate by geometry rather than by name
// - two different roads can share a name, but never share the same line.
check('merging two collections drops the road they both carry, by its geometry', (() => {
  const shared = { type: 'Feature', properties: { NAME: 'X' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } };
  const a = { type: 'FeatureCollection', features: [shared, { type: 'Feature', properties: { NAME: 'A' }, geometry: { type: 'LineString', coordinates: [[0, 0], [2, 2]] } }] };
  const b = { type: 'FeatureCollection', features: [shared, { type: 'Feature', properties: { NAME: 'B' }, geometry: { type: 'LineString', coordinates: [[3, 3], [4, 4]] } }] };
  const merged = mergeBackdropFeatures([a, b]);
  return [merged.features.length, merged.features.map((f) => f.properties.NAME).sort().join(',')];
})(), [3, 'A,B,X']);
// THE SEAMS WHERE TWO NEIGHBOURS MEET are de-duplicated when their roads are stitched together: one geometry, kept once.
check('roads from two neighbours that share a street are merged and de-duplicated', (() => {
  const shared = { type: 'LineString', coordinates: [[-78, 34], [-77, 34]] };
  const only = { type: 'LineString', coordinates: [[-78, 33], [-77, 33]] };
  const merged = mergeBackdropFeatures([
    { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { NAME: 'A' }, geometry: shared }] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { NAME: 'B' }, geometry: shared }, { type: 'Feature', properties: { NAME: 'C' }, geometry: only }] },
  ]);
  return merged.features.length;
})(), 2);
check('and the merge keeps each road\'s own attributes as they came, for the name to be drawn from', (() => {
  const merged = mergeBackdropFeatures([
    { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { NAME: 'A', FULLNAME: 'A' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] },
  ]);
  return merged.features[0].properties.NAME;
})(), 'A');

console.log('\n--- the device copy, which is what draws the map with no signal ---');
// A stub rather than a browser: the cache is guarded at every step (a Node harness has none, and a private-mode browser
// throws on write), so what is worth asserting is that the guards answer MISS rather than throwing.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => {
    store.set(key, String(value));
  },
  removeItem: (key) => {
    store.delete(key);
  },
};
const SAVED = { svg: GOOD, width: 400, height: 300, view_box: '0 0 400 300' };
check('nothing cached reads as nothing', cachedMapLayer(), null);
check('a drawing caches', cacheMapLayer(SAVED), true);
check('and reads back whole', cachedMapLayer(), SAVED);
check("under ONE key, since the map is the station's and not the member's", [...store.keys()], [MAP_LAYER_CACHE_KEY]);
check('rubbish in the cache is ignored rather than thrown', (store.set(MAP_LAYER_CACHE_KEY, 'not json'), cachedMapLayer()), null);
check('and so is a document with no drawing in it', (store.set(MAP_LAYER_CACHE_KEY, JSON.stringify({ svg: '   ' })), cachedMapLayer()), null);
// Taking the map down clears the copy, or the next visit would draw the map an officer has just removed.
check('removing the map clears the copy as well', [cacheMapLayer({ svg: '' }), store.has(MAP_LAYER_CACHE_KEY)], [true, false]);
check('and it can be cleared outright', [cacheMapLayer(SAVED), clearCachedMapLayer(), store.has(MAP_LAYER_CACHE_KEY)], [true, true, false]);
// The boundary caches the same way, under its own key - two keys rather than one because a station can have either without
// the other, and because a boundary that failed to save must not leave a stale drawing behind it.
check('the boundary caches and reads back', (cacheBoundary({ geojson: '{"type":"Polygon"}', points: 3 }), cachedBoundary()), {
  geojson: '{"type":"Polygon"}',
  points: 3,
});
check('under a key of its own', store.has('sp_district_boundary'), true);
check('and removing the boundary CLEARS the copy, or it would come back', (cacheBoundary(null), cachedBoundary()), null);
delete globalThis.localStorage;
check('a device with no storage is a MISS, not a crash', [cachedMapLayer(), cacheMapLayer(SAVED), clearCachedMapLayer()], [null, false, false]);

console.log('\n--- the wiring, which none of these files fails loudly about ---');
const source = (path) => readFileSync(path, 'utf8');
const app = source('src/App.jsx');
const sidebar = source('src/components/navigation/Sidebar.jsx');
const bottomNav = source('src/components/navigation/MobileBottomNav.jsx');
const navModules = source('src/utils/mobileNav.js');
const settingsTab = source('src/components/admin/AdminSystemSettingsTab.jsx');
// THE MAP'S OWN SCREEN. The boundary, the background and the drawing were three cards inside System Settings; they are the
// ground the station covers rather than station configuration, so they moved to Administration → System → Map Settings, and
// the checks below that used to read the settings tab read this one instead.
const mapSettingsTab = source('src/components/admin/AdminMapSettingsTab.jsx');
// The module itself, read as text: the checks below are about what the screen is WIRED to, which the build cannot tell.
const moduleSource = source('src/components/DistrictMap.jsx');
// The shared style tables beside it, read as text too: which ground each layer is drawn on is data in that file rather than
// something the screen decides, so the theme checks below read it there.
const utilsSource = source('src/utils/districtMap.js');
const deferred = source('src/utils/deferredModules.js');
// The panel that hosts the map's settings screen, and the labels the app bar reads: both are lists that a new tab has to be
// added to, and neither fails loudly when it is missed.
const panelSource = source('src/components/admin/AdminPanel.jsx');
const barLabels = source('src/utils/pageLabels.js');
const rules = source('firestore.rules');

// THE PIN'S OWN STYLE, parsed rather than trusted.
//
// THIS IS THE CHECK THAT WOULD HAVE CAUGHT THE RELEASE THE PINS SHIPPED IN: they were drawn with NO FILL, because the colour was
// concatenated onto a shared string with no semicolon between them - gluing `box-shadow:...rgba(15,23,42,0.45)` and
// `background:#dc2626` into ONE declaration, which a browser drops whole. Nothing reports that: the build is clean, the styles
// are valid JavaScript, and the map simply draws white glyphs on whatever happens to be underneath them.
const pinStyle = mapPinStyle('#dc2626');
check('a pin\'s style parses into declarations', styleDeclarations(pinStyle).length, 8);
check('and the FILL is first, because it is the one a pin cannot do without', styleDeclarations(pinStyle)[0], 'background:#dc2626');
check('a selected pin\'s ring does not cost it the rest', styleDeclarations(mapPinStyle('#dc2626', 'box-shadow:0 0 0 2px #fff;')).length, 9);
check('the glued declaration that shipped is REFUSED rather than parsed', styleDeclarations('display:flex;box-shadow:0 1px 3px rgba(15,23,42,0.45)background:#dc2626'), []);
checkIs(
  'and the screen builds both its pins with that one function',
  (moduleSource.match(/mapPinStyle\(/g) || []).length >= 2,
  'the saved pins and the pin being placed have to look the same'
);


// ...AND THE TYPES REACH THE SCREEN. Every one of these is wiring, which parses and builds perfectly while showing a station the
// wrong legend: a card that saves a list nobody reads, or a marker drawn from a table of its own.
const glyphSource = source('src/components/map/MapTypeGlyph.jsx');
check(
  "the read and the write are the map feature's, like the boundary's",
  [ROUTED_READS.GET_MAP_TYPES, ROUTED_WRITES.ADMIN_SAVE_MAP_TYPES],
  ['districtMap', 'districtMap']
);
checkIs(
  'the screen reads the types with everything else on it, and keeps them on the device',
  /fetchMapTypes\(\)/.test(moduleSource) && /cachedMapTypes\(\)/.test(moduleSource) && /cacheMapTypes\(typeAnswer\.value\)/.test(moduleSource)
);
checkIs(
  'and every marker is drawn with the type its pin names',
  /mapTypeFor\(types, pin\?\.kind\)/.test(moduleSource) && /glyphHtml\(type\.icon/.test(moduleSource),
  'a marker drawn from anything else is a legend that lies'
);

// THE PIN BEING PLACED, the overlay hint, and the landmarks layer - three fixes whose absence is invisible to a build.
checkIs(
  'the pin being placed is DRAWN, at the position the tap recorded',
  /const draftLayerRef = useRef\(null\)/.test(moduleSource) &&
    /L\.marker\(\[draft\.lat, draft\.lng\]/.test(moduleSource) &&
    /draftLayerRef\.current = marker/.test(moduleSource),
  'a tap with no marker on screen is a tap nobody can check'
);
checkIs(
  'and it can be DRAGGED, writing the new position back into the draft the save reads',
  /draggable: true/.test(moduleSource) && /marker\.on\('dragend'/.test(moduleSource) && /lat: at\.lat, lng: at\.lng/.test(moduleSource)
);
checkIs(
  'the placing hint is an OVERLAY inside the map card rather than a strip that changes the layout',
  /pointer-events-none absolute inset-x-2 top-2/.test(moduleSource) && !/Press the map where the landmark is\.<\/span>\s*<\/div>\s*\) : null\}\s*<\/>/.test(moduleSource),
  'a strip added and removed at tap time shrinks the page under the officer finger, and the map slides with it'
);
checkIs(
  'the landmarks are a layer with a switch of their own, in the same row as the others',
  /layersOn\.landmarks/.test(moduleSource) && /Landmarks\s*<\/button>/.test(moduleSource) && /Layers\s*<\/span>/.test(moduleSource)
);
checkIs(
  'and switching them off stops them being DRAWN rather than hiding them',
  /if \(!layersOn\.landmarks\)/.test(moduleSource) && /pinLayerRef\.current = null/.test(moduleSource)
);
checkIs(
  'while the pin being placed stays visible even when the saved ones are switched off',
  !/layersOn\.landmarks/.test(moduleSource.split('// ---- the pin being placed')[1].split('// ---- placing a pin')[0]),
  'the officer placing a pin has to be able to see it'
);

// WHERE A MARKER IS ANCHORED, every marker on this map: the centre of its own box (or, for a label, a zero-sized point that
// centres its own content). This is the arithmetic that decides whether a landmark lands under the officer's finger or half an
// icon away from it, and it is arithmetic a build cannot check - Leaflet's default anchor for a divIcon with no anchor puts the
// point at the box's TOP-LEFT corner.
//
// FOUR OF THEM: the saved pins, the pin being placed, the road names, and the name in the middle of a neighbouring district.
const markerIcons = [...moduleSource.matchAll(/iconSize:\s*\[(\w+), (\w+)\],\s*iconAnchor:\s*\[([^,]+), ([^\]]+)\]/g)];
check('every marker on the map declares a size and an anchor', markerIcons.length, 4);
markerIcons.forEach(([, width, height, anchorX, anchorY], index) => {
  const anchor = `${anchorX.trim()}|${anchorY.trim()}`;
  if (width === '0') {
    // A bare point - a label - with the name's own span centring itself on it.
    check(`marker ${index + 1} is a bare point whose content centres itself`, `${height}|${anchor}`, '0|0|0');
    return;
  }
  check(
    `marker ${index + 1} is square and anchored at its middle, so it lands where it was placed`,
    `${width === height}|${anchor}`,
    `true|${width} / 2|${height} / 2`
  );
});
checkIs(
  "the picker offers the station's list rather than a list of its own",
  /types\.map\(\(type\) => \{/.test(moduleSource) && !/LANDMARK_KINDS/.test(moduleSource)
);
checkIs('the card that edits the list is on the map settings screen', /<MapTypesCard token=\{token\}/.test(mapSettingsTab) && /adminSaveMapTypes/.test(mapSettingsTab));
checkIs(
  'and it counts the pins wearing each type, which is what makes removing one honest',
  /fetchMapLandmarks\(\)/.test(mapSettingsTab) && /usage\[type\.key\]/.test(mapSettingsTab)
);
checkIs(
  'the same glyph is drawn on the marker, in the picker and in the legend',
  /iconElements\(icon\)/.test(glyphSource) && /export const glyphHtml/.test(glyphSource) && /export default function MapTypeGlyph/.test(glyphSource)
);
checkIs(
  'the icon table is generated from lucide rather than hand-copied, and checked against it',
  /GENERATED BY scripts\/map-icon-paths\.mjs/.test(source('src/utils/mapIcons.js')) && /verify:map-icons/.test(source('package.json')),
  'a hand-copied path draws nothing and looks like a styling problem'
);
checkIs(
  'and the rules put the type list behind the same pair of permissions as the boundary',
  /match \/map_types\/\{typeDocId\}[\s\S]{0,500}permission\('can_view_map'\)[\s\S]{0,500}permission\('can_edit_map'\)/.test(rules) &&
    /typeDocId == 'station'/.test(rules)
);


check(
  'the read and both writes belong to one feature',
  [ROUTED_READS.GET_MAP_LAYER, ROUTED_WRITES.ADMIN_SAVE_MAP_LAYER, ROUTED_WRITES.ADMIN_DELETE_MAP_LAYER],
  ['districtMap', 'districtMap', 'districtMap']
);
check('which requires the member payload, because the permission comes from the role', ROUTED_FEATURES.districtMap.requires, ['memberPayload']);
checkIs(
  'and the reader and the writers it names actually exist',
  /GET_MAP_LAYER:/.test(source('src/services/firestoreReads.js')) &&
    /export const saveMapLayer/.test(source('src/services/firestoreWrites.js')) &&
    /export const deleteMapLayer/.test(source('src/services/firestoreWrites.js')),
  'a routed action with no reader or writer fails at runtime rather than at build time'
);

const mapPermission = MEMBER_PERMISSIONS.find((permission) => permission.key === 'can_view_map');
checkIs(
  'the map has a permission of its own, labelled and described',
  Boolean(mapPermission && mapPermission.label && mapPermission.description),
  'a permission with no words is one nobody can grant knowingly'
);
check(
  'with a heading to be drawn under, above Chat',
  MEMBER_PERMISSION_GROUPS.map((group) => group.label),
  ['Their own schedule and hours', 'The crew and its records', 'The district', 'Chat']
);
check('holding it and nothing else', MEMBER_PERMISSION_GROUPS.find((group) => group.label === 'The district').keys, ['can_view_map', 'can_edit_map']);
// Maintaining the map is a permission of its own, and it RESTS on seeing it: a switch that edits a map nobody may look at
// is a switch nobody can use, and the Roles form draws the dependency from this field.
const editMap = MEMBER_PERMISSIONS.find((permission) => permission.key === 'can_edit_map');
check('maintaining the map rests on seeing it', editMap?.requires, 'can_view_map');

checkIs('the tab renders only with the permission', /\{activeTab === 'district-map' && canViewMap && \(/.test(app));
checkIs('and the same flag closes it if a role changes under the member', /activeTab === 'district-map'\s*\n\s*\? canViewMap/.test(app));
checkIs('the sidebar offers it only with the flag', /\{canViewMap && \(/.test(sidebar) && /setActiveTab\('district-map'\)/.test(sidebar));
checkIs('the mobile bar knows its label and its icon', /'district-map': \{ label: 'Map'/.test(bottomNav), 'the entry would render a raw id');
checkIs('and refuses it without the flag', /case 'district-map':\s*\n\s*return Boolean\(canViewMap\)/.test(bottomNav));
checkIs('an administrator can even put it in the mobile bar', /id: 'district-map'/.test(navModules));
checkIs('the mobile app bar has a short label for it', /'district-map': 'District Map'/.test(source('src/utils/pageLabels.js')));
checkIs(
  "the module is deferred rather than pulled into everybody's first load",
  /DistrictMap: \(\) => import\('\.\.\/components\/DistrictMap'\)/.test(deferred) &&
    /export const DistrictMap = lazy\(loaders\.DistrictMap\)/.test(deferred)
);
checkIs('and Leaflet is warmed only for a member who can open the map', /if \(canViewMap\) keys\.push\('DistrictMap'\)/.test(deferred));

checkIs(
  'the rule gates the READ on the permission and the WRITE on the tab it is edited from',
  /match \/map_layers\/\{layerId\} \{[\s\S]{0,700}permission\('can_view_map'\)[\s\S]{0,500}permission\('can_edit_system_settings'\)/.test(rules)
);
// The rules cannot import a constant, so the number is repeated there - and a repeated number is exactly what drifts. A cap
// that is a backstop in one place and a promise in the other has to be the same number.
const ruleCap = Number((rules.match(/match \/map_layers[\s\S]*?\.size\(\) < (\d+)/) || [])[1]);
check('and its size backstop is the SAME number the browser checks', ruleCap, MAP_LAYER_MAX_BYTES);
checkIs(
  'the upload card lives on that tab and calls both writes',
  /<DistrictMapCard token=\{token\}/.test(mapSettingsTab) &&
    /adminSaveMapLayer/.test(mapSettingsTab) &&
    /adminDeleteMapLayer/.test(mapSettingsTab)
);
// ...AND THE TAB IS THE MAP'S OWN SCREEN, which is the move this feature made: three cards that were a section of System
// Settings are a screen of their own under System, reached by the permission that already opened them, with a line left behind
// where they used to be. Every part of that is wiring rather than code, so none of it fails loudly at build time.
checkIs(
  'the map settings tab renders the boundary before the background it is clipped to',
  mapSettingsTab.indexOf('<DistrictBoundaryCard') !== -1 &&
    mapSettingsTab.indexOf('<DistrictBoundaryCard') < mapSettingsTab.indexOf('<MapBackgroundCard'),
  'the boundary is what the background is clipped to, so it comes first'
);
// EACH CARD FOLLOWS THE PERMISSION ITS SAVE NEEDS, because this screen opens for two different ones. A card shown to somebody
// whose save the server would refuse is the failure this pins - and so is a card that a permitted officer can no longer reach.
checkIs(
  'the boundary, the background and the landmark types follow the map permission, and the drawing the settings one',
  /canEditMap \? \(\s*<>[\s\S]{0,200}<DistrictBoundaryCard[\s\S]{0,600}<MapTypesCard[\s\S]{0,200}<\/>\s*\)[\s\S]{0,600}canEditSystemSettings \? \(\s*<DistrictMapCard/.test(
    mapSettingsTab
  ),
  'the three cards the map permission covers, then the one the settings permission covers'
);
checkIs(
  'and a card that cannot be used is replaced by the permission it needs, not by a control that refuses',
  /function NeedsPermission\(\{ what, children \}\)/.test(mapSettingsTab) &&
    /which your role does not hold/.test(mapSettingsTab),
  'a save button the server refuses is worse than a sentence naming the switch'
);
checkIs(
  'the panel hands those two flags down from the role it already holds',
  /canEditMap=\{permissionGranted\(currentRole, 'can_edit_map'\)\}/.test(panelSource) &&
    /canEditSystemSettings=\{permissionGranted\(currentRole, 'can_edit_system_settings'\)\}/.test(panelSource)
);
checkIs(
  'and the settings tab no longer renders them',
  !/<DistrictMapCard|<MapBackgroundCard|<DistrictBoundaryCard/.test(settingsTab)
);
checkIs(
  'it keeps a line pointing at the screen they went to, and that line opens it',
  /<MapSettingsPointer onOpenMapSettings=\{onOpenMapSettings\}/.test(settingsTab) &&
    /onOpenMapSettings=\{\(\) => onSelectTab\('map'\)\}/.test(panelSource),
  'a card that vanished without a word reads as a feature that was removed'
);
checkIs(
  'the tab is in the System group of the nav, with a label for the app bar',
  /{ id: 'map', label: 'Map Setup', icon: MapIcon }/.test(panelSource) && /map: 'Map Settings'/.test(barLabels),
  'the panel and the bar are separate lists, and a missing label renders as "Admin: "'
);
checkIs(
  'and the panel renders it only while its own sub-tab is open',
  /\{activeSubTab === 'map' && \([\s\S]{0,120}<AdminMapSettingsTab/.test(panelSource)
);
checkIs(
  'it is reached by the SAME permission as System Settings, so the move takes nothing away',
  (ADMIN_PERMISSIONS.find((permission) => permission.key === 'can_edit_system_settings')?.moreTabs || []).includes('map'),
  'moreTabs is how one permission reaches a second screen of the same responsibility'
);
// ...AND NOBODY'S LANDING TAB MOVED. The panel opens on the first tab a role holds, so a tab added in front of System Settings
// would have quietly changed where every settings officer arrives - which is why the map tab rides behind it in the list.
check(
  'a settings officer lands on System Settings, with the map tab beside it',
  allowedAdminTabs({ can_edit_system_settings: true }),
  ['system', 'map', 'navigation', 'help']
);
check('and a role without it cannot open the map screen at all', roleAllowsTab({ can_manage_documents: true }, 'map'), false);

// THE OTHER DOOR INTO THE SCREEN, which is the point of the map's own permission: an officer who maintains the map but holds no
// administrator permission at all. Until now `can_edit_map` could draw pins on the map and could not reach the screen that sets
// the boundary they are drawn against.
check('maintaining the map opens Administration on its own', roleHasAdministration({ can_view_map: true, can_edit_map: true }), true);
check(
  'with the map screen as the tab it lands on, not Help',
  allowedAdminTabs({ can_view_map: true, can_edit_map: true }),
  ['map', 'help']
);
check('and it does NOT open the station-wide settings screen', roleAllowsTab({ can_view_map: true, can_edit_map: true }, 'system'), false);
// A member who may only LOOK at the map still gets no Administration at all: the switch that maintains it is a different one,
// and this is the line between them.
check('while viewing the map opens nothing', allowedAdminTabs({ can_view_map: true }), []);
check('and the two permissions each open the screen on their own', [
  roleAllowsTab({ can_view_map: true, can_edit_map: true }, 'map'),
  roleAllowsTab({ can_edit_system_settings: true }, 'map'),
], [true, true]);

// THE REAL MAP, whose wiring is a wider net than the drawing's: two more collections, a permission of its own, a card that
// puts the boundary there, and a screen that draws it. None of these fails loudly when it is missed - an unwired card is a
// boundary nobody can set, and a rule naming the wrong permission is a map that cannot be edited.
check(
  'the boundary and the pins belong to the same feature as the drawing',
  [ROUTED_READS.GET_MAP_BOUNDARY, ROUTED_READS.GET_MAP_LANDMARKS, ROUTED_WRITES.ADMIN_SAVE_MAP_BOUNDARY, ROUTED_WRITES.ADMIN_DELETE_MAP_BOUNDARY, ROUTED_WRITES.ADMIN_SAVE_MAP_LANDMARK, ROUTED_WRITES.ADMIN_DELETE_MAP_LANDMARK],
  ['districtMap', 'districtMap', 'districtMap', 'districtMap', 'districtMap', 'districtMap']
);
const rulesBoundary = rules.match(/match \/map_boundaries[\s\S]*?\n    \}/) || [''];
const rulesLandmarks = rules.match(/match \/map_landmarks[\s\S]*?\n    \}/) || [''];
checkIs(
  'the boundary is readable with the view flag and writable with the map permission',
  /permission\('can_view_map'\)/.test(rulesBoundary[0]) && /permission\('can_edit_map'\)/.test(rulesBoundary[0]),
  rulesBoundary[0].slice(0, 120)
);
checkIs(
  'and the pins the same, with the position bounded rather than merely present',
  /permission\('can_edit_map'\)/.test(rulesLandmarks[0]) &&
    /data\.lat >= -90/.test(rulesLandmarks[0]) &&
    /data\.lng <= 180/.test(rulesLandmarks[0]),
  rulesLandmarks[0].slice(0, 200)
);
checkIs(
  'the boundary card is on the tab that owns it, and asks the county from there',
  /<DistrictBoundaryCard token=\{token\} systemSettings=\{systemSettings\}/.test(mapSettingsTab) &&
    /adminSaveMapBoundary/.test(mapSettingsTab) &&
    /searchFireBeats/.test(mapSettingsTab)
);
checkIs(
  'the screen draws the boundary, keeps it offline, and lets an officer add a pin',
  /L\.geoJSON\(/.test(moduleSource) &&
    /cachedBoundary\(\)/.test(moduleSource) &&
    /adminSaveMapLandmark/.test(moduleSource) &&
    /canEdit/.test(moduleSource)
);
checkIs('and the app hands it the editing permission', /canEdit=\{canEditMap\}/.test(app), 'the Add landmark button would never appear');
checkIs('the module offers the drawing as a second view rather than dropping it', /DistrictMapDrawing/.test(moduleSource));

// THE BACKGROUND, wired: the layers belong to the same feature, the collection is gated on the same two permissions with the
// layer id checked, the card that fetches it is on the settings tab, and the screen draws it BELOW the boundary - which is
// what the pane is for.
check(
  'the backgrounds belong to the map feature',
  [ROUTED_READS.GET_MAP_BACKDROPS, ROUTED_WRITES.ADMIN_SAVE_MAP_BACKDROP, ROUTED_WRITES.ADMIN_DELETE_MAP_BACKDROP],
  ['districtMap', 'districtMap', 'districtMap']
);
const rulesBackdrops = rules.match(/match \/map_backdrops[\s\S]*?\n    \}/) || [''];
checkIs(
  'readable with the view flag and writable with the map permission',
  /permission\('can_view_map'\)/.test(rulesBackdrops[0]) && /permission\('can_edit_map'\)/.test(rulesBackdrops[0]),
  rulesBackdrops[0].slice(0, 140)
);
checkIs(
  'with the LAYER ID checked, so a typo cannot write a document nothing reads',
  /layerId in \['roads', 'water', 'flood', 'districts', 'neighbourRoads'\]/.test(rulesBackdrops[0]),
  rulesBackdrops[0].slice(0, 200)
);
checkIs(
  'the card that fetches them is on the map settings tab',
  /<MapBackgroundCard token=\{token\}/.test(mapSettingsTab) && /fetchCountyBackdrop/.test(mapSettingsTab) && /adminSaveMapBackdrop/.test(mapSettingsTab)
);
// WHICH CLIP A LAYER GETS IS THE APP'S DECISION, so the card hands over BOTH shapes and lets services/countyGis pick: a card
// that had to know which layer wanted which would eventually get it wrong, and the symptom would be a background that stops at
// the district line - or a fetch of the whole county.
checkIs(
  'and hands over both clips, so a layer is never fetched with the wrong shape',
  /esriClipFrom\(boundary\.geojson\)/.test(mapSettingsTab) && /esriBandFrom\(boundary\.geojson, MAP_BACKDROP_BAND_METRES\)/.test(mapSettingsTab)
);
checkIs(
  'and tells the county who this station is, so its own beat is not fetched as a neighbour',
  /exclude: boundary\.agency/.test(mapSettingsTab)
);
checkIs(
  'and the card says what a layer keeps, and offers Refresh when it kept nothing',
  /MAP_BACKDROP_FIELDS\[layer\]/.test(mapSettingsTab) && /stored before the app kept the road names/.test(mapSettingsTab),
  'a road layer fetched before this feature would sit there with no names on it and no explanation'
);
checkIs(
  'and the screen draws them, switches them, and keeps them on the device',
  /L\.geoJSON\(/.test(moduleSource) &&
    /MAP_BACKDROP_STYLE/.test(moduleSource) &&
    /cachedBackdrops\(\)/.test(moduleSource) &&
    /setLayersOn/.test(moduleSource)
);
checkIs(
  'below the boundary rather than over it: Leaflet\'s own tile pane, which is the pane for background imagery',
  /const pane = 'tilePane';/.test(moduleSource),
  'a background fetched after the boundary would draw over it in the overlay pane'
);
checkIs(
  'and no raw z-index of our own, because the app keeps exactly one of those',
  // A property, not a Leaflet option: `zIndexOffset` on the pin being placed is marker ORDER within a pane (Leaflet's own
  // ordering, no CSS involved), while `zIndex: 10` would be a stacking claim this screen has no business making. The word
  // boundary tells the two apart, which is the difference between a rule and a tripwire.
  !/\bzIndex\b/.test(moduleSource) && /zIndexOffset: 1000/.test(moduleSource),
  'scripts/verify-schedule-drop.mjs counts raw CSS z-indexes app-wide'
);

// THE NAMES AND THE BOXES on the map: the labels come from the shared arithmetic, and the background binds NO tooltip anywhere -
// a tap that popped a box repeating what the ground already says was the complaint, three times over (roads, nearby roads, flood
// zones), and the districts fix before it. The names on the ground ARE the answer, and the pin names are escaped on their way
// into markup.
checkIs(
  'the map labels its roads with the shared arithmetic rather than its own',
  /roadLabels\(\{ features: roadFeatures \}/.test(moduleSource)
);
checkIs(
  'and both road layers feed one call, so a highway through both gets one label not two',
  /backdrops\.roads\.collection\?\.features/.test(moduleSource) && /backdrops\.neighbourRoads\.collection\?\.features/.test(moduleSource)
);
checkIs(
  'while no background layer pops a box on a press - only pins bind tooltips',
  (moduleSource.match(/bindTooltip/g) || []).length === 2,
  'a background layer still binds a tooltip'
);
// THE TWO LAYERS ADDED LATER, drawn and switchable like the rest. The flood wash takes its colour PER ZONE from the shared
// palette rather than from a style of its own, and the districts around this one are dashed outlines with the county's name for
// the beat in the middle of each - with this station's own beat filtered out on the way IN, which is belt as well as braces.
checkIs(
  'the map draws each flood zone in FEMA\'s own colour, with no box on a press',
  /floodZoneColour\(feature\?\.properties\)/.test(moduleSource) && !/floodZoneDetail\(feature\?\.properties\)/.test(moduleSource)
);
checkIs(
  'and draws the districts around this one as dashed outlines, named in the middle of their own ground',
  /dashArray: ground\.districts\.dash/.test(moduleSource) &&
    /neighbourName\(feature\?\.properties\)/.test(moduleSource) &&
    /getBounds\(\)\.getCenter\(\)/.test(moduleSource)
);
checkIs(
  'while this station\'s own beat is never drawn as a neighbour',
  /filter: \(feature\) => !ours \|\| neighbourName/.test(moduleSource),
  'a boundary uploaded as a file has no agency for the county to exclude'
);
checkIs('and the new layers are switches like the rest, on to begin with', /flood: true, districts: true, neighbourRoads: true/.test(moduleSource));
// THE WHITE BOX IS GONE: a press on a neighbouring district used to pop a tooltip that repeated the name already printed in
// the middle of its ground, which was noise. The area no longer binds one - the name on the ground IS the answer - so the map
// has no bindTooltip inside the districts layer, and its fill stops taking clicks entirely.
checkIs(
  'and a neighbouring district no longer pops a box on a press, because its name is already on the ground',
  /interactive: false,\n(?:\s*\/\/[^\n]*\n)*\s*filter: \(feature\) => !ours \|\| neighbourName/.test(moduleSource) &&
    !/neighbourDetail/.test(moduleSource),
  'the districts layer still binds a tooltip, or still computes the detail nobody reads'
);
checkIs(
  'while the nearby roads are drawn, dimmer than our own, switched like the rest, and named on the ground',
  /ground\.neighbourRoads\.color/.test(moduleSource) && /layersOn\.neighbourRoads/.test(moduleSource) && /neighbourRoads\.collection/.test(moduleSource),
  'the nearby-roads layer is not drawn or not switched'
);
checkIs(
  'the labels keep their own pane, so the boundary cannot hide them',
  /pane: 'shadowPane'/.test(moduleSource),
  'they were in the tooltip pane, which is where a landmark name is written'
);

// THE PANE LADDER, read out of LEAFLET'S OWN STYLESHEET rather than quoted from memory, and then used to check the one rung this
// screen chooses for itself.
//
// THE BUG THIS PINS DOWN: a pin's name is a TOOLTIP, and the road names were drawn in the tooltip pane too - the same pane. Within
// one pane whatever is added last is drawn last, and the names are rebuilt on every zoom, so they were always last: a landmark's
// name was painted UNDER any street name near it. Nothing about that fails a build or a stylesheet check, and on a quiet road it
// looks perfectly fine - it only shows up where a name happens to sit next to a pin.
const leafletPanes = Object.fromEntries(
  [...readFileSync('node_modules/leaflet/dist/leaflet.css', 'utf8').matchAll(/\.leaflet-([a-z-]*-)pane\s*\{\s*z-index:\s*(\d+)/g)].map(
    ([, name, zIndex]) => [name.replace(/-$/, ''), Number(zIndex)]
  )
);
check('Leaflet\'s pane ladder, as its own stylesheet states it', [
  leafletPanes.tile,
  leafletPanes.overlay,
  leafletPanes.shadow,
  leafletPanes.marker,
  leafletPanes.tooltip,
  leafletPanes.popup,
], [200, 400, 500, 600, 650, 700]);

// The labels' own pane, taken from the marker the label effect builds rather than from anywhere else in the file - then turned
// into a rung of the ladder above. Leaflet writes its panes as `leaflet-<name>-pane`, so the code-side `shadowPane` is the
// stylesheet's `shadow`: the same mapping Leaflet's own createPane does, spelled out here rather than assumed. The label call
// now merges both road layers first, so the match reaches past the merged call to the marker it builds.
const labelPane = moduleSource.match(/roadLabels\(\{ features: roadFeatures \}[\s\S]{0,1200}?pane: '(\w+)'/)?.[1] || '';
const labelRung = leafletPanes[labelPane.replace(/Pane$/, '').toLowerCase()];
check('the road names are drawn on a rung Leaflet actually has', labelRung, leafletPanes.shadow);
checkIs(
  'above the roads AND the boundary, so neither can bury a name',
  labelRung > leafletPanes.tile && labelRung > leafletPanes.overlay,
  `${labelPane} (${labelRung}) has to beat the roads (${leafletPanes.tile}) and the boundary (${leafletPanes.overlay})`
);
checkIs(
  'and BELOW the tooltips and popups, because a landmark name IS a tooltip and must not be painted under a street name',
  labelPane !== 'tooltipPane' && labelPane !== 'popupPane' && labelRung < leafletPanes.tooltip && labelRung < leafletPanes.popup,
  `${labelPane} (${labelRung}) is not under the tooltips (${leafletPanes.tooltip})`
);
checkIs(
  "and a road's name is escaped on its way into markup, because it is somebody else's data",
  /escapeHtml\(label\.name\)/.test(moduleSource)
);
checkIs(
  'the background never takes taps at all - nothing to swallow the press that places a pin',
  !/interactive: !placing/.test(moduleSource) && (moduleSource.match(/interactive: false/g) || []).length >= 5,
  'a background layer still takes taps'
);
// DARK GROUND, defaulting to the member's own app setting: the canvas is Leaflet's own drawing, so the app's `dark` class
// never reaches it - which is why a toggle that only flipped the chrome would leave a torch in a dark truck. The checks below
// pin the three things that make it real: the toggle opens matching the app, every drawn colour reads from one decision, and
// the table it reads from keeps the flood facts factual.
checkIs(
  'the map opens on the member\'s own ground - dark in a dark app, light in a light one',
  /document\.documentElement\.classList\.contains\('dark'\)/.test(moduleSource),
  'the toggle opens on a fixed theme instead of the member\'s'
);
checkIs(
  'and every drawn element reads the toggle, so flipping it redraws the whole map',
  /const ground = useMemo\(\(\) => backdropStyleFor\(mapDark\), \[mapDark\]\)/.test(moduleSource) &&
    /boundaryGround = mapDark \? BOUNDARY_STYLE_DARK : BOUNDARY_STYLE/.test(moduleSource) &&
    /labelTextStyle\(label\.bearing, mapDark\)/.test(moduleSource) &&
    /areaTextStyle\(mapDark\)/.test(moduleSource),
  'a colour is still read from the light table directly'
);
checkIs(
  'while the dark table carries every layer the light one does, with the same drawing',
  (() => {
    const parse = (name) => {
      const match = utilsSource.match(new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\};`));
      if (!match) return null;
      return Object.fromEntries(
        [...match[1].matchAll(/^\s{2}(\w+): \{/gm)].map(([, key]) => [key, true])
      );
    };
    const light = parse('MAP_BACKDROP_STYLE');
    const dark = parse('MAP_BACKDROP_STYLE_DARK');
    if (!light || !dark) return false;
    const keys = Object.keys(light);
    return keys.length >= 5 && keys.every((key) => dark[key]);
  })(),
  'a layer missing from the dark table would draw with the light one on dark ground'
);
checkIs(
  'and FEMA still paints its zones - a fact does not change with the hour',
  /FLOOD_ZONE_COLOURS\[floodZone\(properties\)\.toUpperCase\(\)\]/.test(utilsSource),
  'the flood wash reads the theme table'
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
