// Asking the county for this station's fire beat.
//
// WHY THIS APP TALKS TO A COUNTY SERVER AT ALL - and why only from here. The map a member sees reads NOTHING from the
// county: an officer fetches the boundary once, it is copied into the station's own document, and from then on the map
// works with no signal and does not break the day somebody else's server is retired (utils/districtMap has that argument in
// full). So this module is the one-off fetch, called from one card in System Settings by a deliberate press - never at
// sign-in, and never by a screen a member opens.
//
// NO KEY, NO ACCOUNT, NO COST. The county publishes its fire beats as an open ArcGIS service and answers a browser
// directly: the response carries `access-control-allow-origin` for the calling origin, which is what makes a fetch from the
// app possible at all. The county's own service is credited on the map, and the boundary is only ever COPIED.
//
// WHAT IS PURE HERE: the search term taken from a department's name, and the URL built from it. Both are asserted in
// scripts/verify-district-map.mjs, because a URL that is one quote wrong asks the county a different question - and the
// answer to that is an empty list, which reads as "your department is not in the county's data".
// The station's own beat, and the layer URL it is searched in. THE BASE RATHER THAN THE QUERY URL is what a layer fetch needs:
// services/countyGis appends `/query` itself, and this same layer is where the NEIGHBOURING districts come from - one layer,
// two questions: "which beat is mine?" by name, and "who is around me?" by geometry.
const COUNTY_FIRE_BEATS_BASE =
  'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Brunsco_Ops/FireBeats/FeatureServer/0';

export const COUNTY_FIRE_BEATS_URL = `${COUNTY_FIRE_BEATS_BASE}/query`;

export const COUNTY_FIRE_BEATS_SOURCE = 'Brunswick County GIS — Brunsco_Ops/FireBeats';

// Where a boundary fetched from here came from, so the map can credit the people who published it.
export const COUNTY_FIRE_BEATS_LAYER = COUNTY_FIRE_BEATS_BASE;

// How long to wait before deciding the county is not answering. A fetch with no ceiling hangs until the browser gives up,
// which on a poor connection is minutes - and the officer is standing at a computer watching nothing happen.
export const COUNTY_TIMEOUT_MS = 20000;

// The words every fire department's name contains, and which therefore say nothing about WHICH department it is. Taken
// away so that "Bolivia Volunteer Fire Department" searches for "Bolivia": the county's own name for it is "BOLIVIA FIRE
// DEPARTMENT", and a LIKE on the whole name would find nothing at all.
const GENERIC_WORDS = new Set([
  'the', 'of', 'and', 'a',
  'fire', 'department', 'dept', 'volunteer', 'vol', 'rescue', 'ems', 'district', 'station',
  'county', 'city', 'town', 'public', 'safety', 'services', 'service', 'company', 'brigade',
]);

// The word to look for: the FIRST word that means something, rather than the longest. Departments are named for their
// place first - Bolivia, Northwest, Sunset Beach, Boiling Spring Lakes - and the word after the place is the generic one.
export const fireBeatSearchTerm = (departmentName) => {
  const words = String(departmentName ?? '')
    .split(/[^\p{L}\p{N}']+/u)
    .map((word) => word.trim())
    .filter(Boolean);
  return words.find((word) => !GENERIC_WORDS.has(word.toLowerCase())) || '';
};

// A value safe inside an ArcGIS SQL string literal: a single quote is doubled, which is how that syntax escapes one. A
// department named "O'Brien" would otherwise close the literal and make the query mean something else - and a malformed
// query comes back as an error nobody can act on.
export const escapeSqlLiteral = (value) => String(value ?? '').replace(/'/g, "''");

// The county's query, built in one place so it can be read and asserted. `outSR=4326` asks for latitude and longitude
// rather than the state-plane feet the county stores its own data in - and feet would be refused by the app's own check,
// rightly: nothing outside that state grid can make sense of them.
export const fireBeatQueryUrl = ({ search = '', limit = 25 } = {}) => {
  const term = String(search ?? '').trim();
  const where = term ? `UPPER(AgencyID) LIKE '%${escapeSqlLiteral(term.toUpperCase())}%'` : '1=1';
  const params = new URLSearchParams({
    where,
    outFields: 'AgencyID,DisplayName,AgencyAbbrv,Zone,ServiceNum',
    returnGeometry: 'true',
    outSR: '4326',
    // GeoJSON rather than the county's own JSON: it is the same shape the app stores, so nothing has to be translated
    // between what arrives and what is saved.
    f: 'geojson',
    resultRecordCount: String(limit),
  });
  return `${COUNTY_FIRE_BEATS_URL}?${params.toString()}`;
};

// One match, as the card lists it: the county's own words for the beat, and the geometry to draw.
export const fireBeatFromFeature = (feature) => {
  const properties = feature?.properties || {};
  return {
    label: String(properties.DisplayName || properties.AgencyID || 'Unnamed beat'),
    agency: String(properties.AgencyID || ''),
    agency_abbrv: String(properties.AgencyAbbrv || ''),
    zone: String(properties.Zone || ''),
    service_num: String(properties.ServiceNum || ''),
    geojson: feature,
  };
};

// --------------------------------------------------------------------------------------------------------------
// THE MAP BACKGROUND: the county's roads and waterways, in three layers across two services.
//
// TWO MORE LAYERS CAME LATER, from a third service and from a service already used here - the FEMA flood zones, and the fire
// districts around this one - and they are the same kind of thing in every way that matters: clipped, generalised, fetched by
// a button and stored as the station's own geometry. What they do NOT share is the clip: the flood zones are wanted for this
// district, while the roads and the districts around it are wanted for this district AND A BAND OF GROUND AROUND IT. Which is
// which is the app's decision (utils/districtMap#MAP_BACKDROP_CLIP), so a caller supplies both clips and this module picks.
//
// Fetched the same way the boundary is - once, by an officer, then stored - but WITH TWO EXTRA ARGUMENTS that make the
// difference between 1.4 MB and 300 KB:
//
//   * a CLIP, so only what falls inside the station's own district comes back. The whole county's roads would be fifteen
//     times the data for countryside nobody answers calls in.
//   * a TOLERANCE (`maxAllowableOffset`), which asks the county to generalise the geometry before sending it. This is the
//     part that matters most, and it is theirs to do properly rather than ours to approximate: water bodies alone are 29,584
//     points at survey detail and 9,806 at five metres, and not one of the 20,000 dropped points was visible at the scale a
//     district is drawn at.
//
// NO ATTRIBUTES ARE REQUESTED. The road layer carries forty fields - names, speed limits, the fire beat on each side of the
// road - and asking for all of them tripled the payload (548 KB against 156 before generalising). A background is drawn, not
// queried; if road names are wanted later, that is a different feature with its own argument, and `FIRELEFT`/`FIRERIGHT`
// are worth remembering when it comes.
import {
  MAP_BACKDROP_CLIP,
  MAP_BACKDROP_FIELDS,
  MAP_BACKDROP_LAYERS,
  NEIGHBOUR_ROAD_WHERE,
  bandBounds,
  boundaryGeometry,
  geometryBounds,
  mergeBackdropFeatures,
} from '../utils/districtMap.js';

export const COUNTY_ROADS_URL =
  'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Mapping/DataViewer/MapServer/4';
export const COUNTY_STREAMS_URL =
  'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Basemaps/HydroBaseWebMercator/MapServer/0';
export const COUNTY_WATER_BODIES_URL =
  'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Basemaps/HydroBaseWebMercator/MapServer/1';
// FEMA's Special Flood Hazard Areas, as the county publishes them - ONE polygon layer carrying the zone in an attribute, which
// is why one URL is enough for a five-colour map (the zone decides the colour; utils/districtMap#floodZoneColour).
export const COUNTY_FLOOD_URL =
  'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Layers/FloodHazards/MapServer/0';

export const COUNTY_BACKDROP_SOURCE = {
  roads: 'Brunswick County GIS — DataViewer/Roads',
  water: 'Brunswick County GIS — HydroBase/Streams & Water Bodies',
  flood: 'Brunswick County GIS — Layers/FloodHazards (FEMA SFHA)',
  // The same people who publish this station's own boundary, which is the honest credit: the neighbouring districts ARE the
  // fire beats layer, asked for everything except ours.
  districts: COUNTY_FIRE_BEATS_SOURCE,
  // The roads layer again, asked only for the arterials that cross into a neighbour's ground (NEIGHBOUR_ROAD_WHERE) - so the
  // credit is the same roads, and the "only major roads" is a filter of ours rather than a different service.
  neighbourRoads: 'Brunswick County GIS — DataViewer/Roads (major roads only)',
};

// IN DEGREES, because the output is asked for in latitude and longitude: 0.00001 is about 1.1 m and 0.00005 about 5.5 m. The
// two differ for the reason utils/districtMap explains - a road has corners somebody can see, a shoreline does not.
//
// THE TWO ADDED LATER ARE WHERE THE MEASURING PAID. A fire beat's line runs down roads, so it is generalised like a road's
// (0.00005, about 5.5 m). The flood zones are 99 polygons inside one district and 1.4 MB at survey detail: at 0.0002 - about
// 22 m, which at the scale a district is drawn is a fifth of a pixel - the same zones are 80 KB, and every edge that a person
// could stand on is still in the right field.
export const COUNTY_BACKDROP_TOLERANCE = { roads: 0.00001, water: 0.00005, flood: 0.0002, districts: 0.00005, neighbourRoads: 0.00005 };

// The clip, in ESRI'S OWN SHAPE rather than GeoJSON: this endpoint takes `{rings: [[[x, y], …]]}`, and handing it a GeoJSON
// polygon is answered with an error object with no message in it - which is exactly what happened the first time this was
// tried. A multipolygon's rings are flattened, which is what a rings array is.
export const esriClipFrom = (geojson) => {
  const geometry = boundaryGeometry(geojson);
  if (!geometry) return null;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return { rings: polygons.flat(), spatialReference: { wkid: 4326 } };
};

// THE SAME DISTRICT, PLUS A BAND, as the BOX that contains it - which is what the two layers that reach past the district line
// are fetched with (`{xmin, ymin, xmax, ymax}` and `esriGeometryEnvelope`, rather than the rings above).
//
// A BOX RATHER THAN A BUFFERED OUTLINE, deliberately. Buffering an outline is the county's GeometryServer's job, and a second
// call to a second service to shape a clip is a dependency bought for a few percent of payload. A box is a SUPERSET of the
// band, so nothing inside the band is ever missed - which is the thing that would be a bug - and what comes back beyond it is
// ground a little further out, which costs bytes and hides nothing.
export const esriBandFrom = (geojson, metres) => {
  const geometry = boundaryGeometry(geojson);
  const bounds = geometry ? geometryBounds(geometry) : null;
  const banded = bandBounds(bounds, metres);
  if (!banded) return null;
  return {
    xmin: banded[0][1],
    ymin: banded[0][0],
    xmax: banded[1][1],
    ymax: banded[1][0],
    spatialReference: { wkid: 4326 },
  };
};

// THE STATION'S OWN BEAT IS NOT A NEIGHBOUR, so the county is asked to leave its department out - which is how the neighbours
// layer arrives already filtered, rather than being fetched and then discarded here. `UPPER()` on both sides because the
// county's own data is upper case and a station's boundary may have come from anywhere; a quote in a department's name is
// escaped for the reason escapeSqlLiteral explains.
//
// NO AGENCY MEANS NO FILTER, which is the honest answer: a boundary uploaded from a file has nothing to match against, and the
// screen drops the one polygon that lands on its own district instead (components/DistrictMap).
export const neighbourWhere = (agency) => {
  const name = String(agency ?? '').trim().toUpperCase();
  if (!name) return '1=1';
  return `UPPER(AgencyID) <> '${escapeSqlLiteral(name)}'`;
};

// THE OUTLINE OF EACH NEIGHBOUR, as an ESRI polygon to clip a second query to. This is how the "nearby roads" layer is fetched:
// the neighbours are asked for first (the same beats query the districts layer uses), and each one's OUTER RING becomes its own
// clip for a roads query - so the roads come back per district rather than as one box around all of them.
//
// WHY PER-DISTRICT AND NOT ONE BIGGER BAND: a multi-ring polygon handed to the county as ONE clip is read as holes, not as a
// union - it comes back EMPTY or truncated - so the districts cannot be sent as one shape. And a single ENVELOPE around them all
// (41 x 46 km) blows past the county's 2,000-record cap and truncates silently. One clip per outline is the shape that actually
// returns the roads, each within the cap; the caller merges and de-duplicates the seams where two neighbours meet.
//
// ONE CLIP PER POLYGON, AND ONE RING INSIDE IT - which is the whole point. A MultiPolygon beat (a district in two pieces) must
// come back as TWO clips, each a single outer ring: the county reads the rings inside ONE polygon clip as a shape with HOLES,
// so two polygons packed into one clip would return the ground BETWEEN them rather than the ground IN them. Flattening to one
// ring per clip is what makes each query mean "this piece of ground".
//
// DOES A RING ENCLOSE GROUND? A polygon's ring must close (its last point equals its first) and have at least three DISTINCT
// corners - a triangle is the smallest shape there is, and anything with fewer is a line or a point wearing a polygon's clothes.
// This is the guard that keeps a county-generalised sliver (which can collapse to one repeated corner) from being sent to the
// county as a clip, where it comes back "Failed to execute query".
const ringHasArea = (ring) => {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const corners = new Set(ring.map((point) => (Array.isArray(point) ? `${point[0]},${point[1]}` : '')));
  return corners.size >= 3;
};

// ONLY OUTER RINGS are taken (a polygon's first ring): the interior rings are holes in the beat, and a hole would punch a gap.
//
// A RING MUST HAVE AREA to be a clip, which is more than "four points". The county generalises a beat's geometry down to what
// fits, and a small sliver of a beat can generalise all the way to a single corner repeated - a ring that is four identical
// points. That is not a polygon, and handing it to the county as a clip comes back "Failed to execute query" (a 400 with an
// empty message), which is exactly the error a member hit on this layer's first fetch. So a ring is kept only if it closes AND
// carries at least three DISTINCT corners - the fewest that make an actual triangle - which is the honest test for "has area"
// that does not need a geometry library.
export const neighbourOutlineRings = (collection) => {
  const features = Array.isArray(collection?.features) ? collection.features : [];
  return features
    .flatMap((feature) => {
      const geometry = boundaryGeometry(feature);
      if (!geometry) return [];
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      return polygons
        .map((polygon) => (Array.isArray(polygon) ? polygon[0] : null))
        .filter((ring) => Array.isArray(ring) && ringHasArea(ring))
        .map((ring) => ({ rings: [ring], spatialReference: { wkid: 4326 } }));
    });
};

// One clipped, generalised query, built in a place that can be read and asserted. POSTed rather than GETted because the clip
// is the district's own outline - 2,245 points, which is a 45 KB URL.
//
// `fields` IS THE LAYER'S OWN LIST (utils/districtMap#MAP_BACKDROP_FIELDS): the roads ask for their name and the department on
// each side, the water asks for nothing. Asking for the road layer's forty fields tripled the payload for information nothing
// draws, which is why the list is explicit rather than '*'.
//
// TWO OPTIONS ARE HERE FOR THE LAYERS ADDED LATER, and both default to what every earlier fetch already sent:
//
//   * `geometryType` - `esriGeometryPolygon` for the district's own outline, `esriGeometryEnvelope` for the band around it.
//   * `where` - `1=1` (everything the clip touches) except for the neighbouring districts, which are the beats layer with this
//     station's own department left out (neighbourWhere).
export const backdropQueryParams = ({ clip, tolerance = 0, fields = [], geometryType = 'esriGeometryPolygon', where = '1=1' }) => {
  const params = new URLSearchParams({
    where,
    geometry: JSON.stringify(clip),
    geometryType,
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    outSR: '4326',
    returnGeometry: 'true',
    outFields: (fields || []).join(','),
    f: 'geojson',
  });
  if (tolerance > 0) params.set('maxAllowableOffset', String(tolerance));
  return params;
};

const askCounty = async (url, params, signal) => {
  // `.../query` IS PART OF THE ADDRESS: posting to the layer endpoint itself is a 400 with nothing useful in it, which is
  // exactly what the first version of this did.
  const response = await fetch(`${url}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    // The body is the only clue when a query is malformed, and it is developer noise to an officer - so it goes to the
    // console and the sentence goes on screen.
    console.warn('[map] the county answered', response.status, text.slice(0, 300));
    throw new Error(`The county's map service answered with HTTP ${response.status}. Try again, or upload the background as a GeoJSON file instead.`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("The county's map service answered with something that was not a map. Try again, or upload the background as a GeoJSON file.");
  }
  // ArcGIS answers a bad query with HTTP 200 and an `error` object inside, and an empty message is common enough that it is
  // reported as such rather than as a blank.
  if (payload && payload.error) {
    throw new Error(`The county's map service refused the query: ${payload.error.message || 'no reason given'}. Try again, or upload the background as a GeoJSON file.`);
  }
  return Array.isArray(payload?.features) ? payload.features : [];
};

//
// THE TWO QUIET FAILURES ARE BOTH HANDLED HERE. A rejected HTTP status is the loud one. The quiet one is ArcGIS answering
// HTTP 200 with an `error` object inside the body - which, left alone, reads as "searched, found nothing", and sends an
// officer looking for a department that is in the data.
//
// A fetch that never left the device (offline, DNS, a blocked origin) reports a bare TypeError with nothing useful in it,
// so it is answered with a sentence about the connection rather than about the county.
// The county's answer for a fire beat, or a thrown error carrying a sentence for the officer.
//
// THE TWO QUIET FAILURES ARE BOTH HANDLED HERE. A rejected HTTP status is the loud one. The quiet one is ArcGIS answering
// HTTP 200 with an `error` object inside the body - which, left alone, reads as "searched, found nothing", and sends an
// officer looking for a department that is in the data.
//
// A fetch that never left the device (offline, DNS, a blocked origin) reports a bare TypeError with nothing useful in it,
// so it is answered with a sentence about the connection rather than about the county.
export const searchFireBeats = async ({ search = '', limit = 25, signal } = {}) => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const onOuterAbort = () => controller?.abort();
  const timer = controller ? setTimeout(() => controller.abort(), COUNTY_TIMEOUT_MS) : null;
  if (signal && controller) signal.addEventListener('abort', onOuterAbort);

  try {
    const response = await fetch(fireBeatQueryUrl({ search, limit }), { signal: controller?.signal });
    if (!response.ok) {
      throw new Error(
        `The county's map service answered with HTTP ${response.status}. Try again, or upload the boundary as a GeoJSON file instead.`
      );
    }
    const payload = await response.json();
    if (payload && payload.error) {
      throw new Error(
        `The county's map service refused the query: ${payload.error.message || 'no reason given'}. Try a different search, or upload the boundary as a GeoJSON file.`
      );
    }
    const features = Array.isArray(payload?.features) ? payload.features : [];
    return { matches: features.map(fireBeatFromFeature), checked: features.length };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        signal?.aborted
          ? 'The search was cancelled.'
          : "The county's map service did not answer in time. Try again, or upload the boundary as a GeoJSON file instead."
      );
    }
    if (error instanceof TypeError) {
      throw new Error(
        "The county's map service could not be reached. Check the connection, or upload the boundary as a GeoJSON file instead."
      );
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && controller) signal.removeEventListener('abort', onOuterAbort);
  }
};

// One clipped, generalised layer as a FeatureCollection, with the attributes the layer asked for.
export const fetchBackdropLayer = async ({ url, clip, geometryType, where, tolerance, fields, signal }) => {
  const features = await askCounty(url, backdropQueryParams({ clip, geometryType, where, tolerance, fields }), signal);
  return { type: 'FeatureCollection', features };
};

// The county's background for one of OUR layers. Four layers, from three services, and one of them runs the same query the
// boundary came from.
//
// THE CLIP IS REQUIRED, and its absence is refused with a sentence rather than by fetching the whole county: a background is
// the district's own ground, and a request without a clip is fifteen times the data for somewhere nobody answers calls. WHICH
// clip - the district's outline or the band around it - is the APP'S decision per layer (utils/districtMap#MAP_BACKDROP_CLIP)
// rather than the caller's argument, so both are handed in and the right one is chosen here.
export const fetchCountyBackdrop = async ({ layer, clip, band, exclude = '', tolerance, signal } = {}) => {
  if (!MAP_BACKDROP_LAYERS.includes(layer)) {
    throw new Error(`There is no map background called "${layer}".`);
  }
  // WHICH SHAPE A LAYER STARTS FROM. `band` and `neighbourhood` layers both start from the band - the neighbouring ROADS are
  // found the same way the neighbouring DISTRICTS are, by asking which beats touch the band - so they need it here too.
  const clipKind = MAP_BACKDROP_CLIP[layer];
  const amongNeighbours = clipKind === 'band' || clipKind === 'neighbourhood';
  const geometry = amongNeighbours ? band : clip;
  if (!geometry) {
    throw new Error(
      'There is no district boundary to clip the background to yet. Set the boundary first: the county has these layers for the whole county, and only what falls around this district is wanted.'
    );
  }
  const offset = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : COUNTY_BACKDROP_TOLERANCE[layer] || 0;
  const fields = MAP_BACKDROP_FIELDS[layer] || [];
  // The envelope is only ever sent for a band layer, and telling the county the wrong shape is an error object with no message
  // in it - so the two travel together rather than being passed in by whoever calls this.
  const geometryType = clipKind === 'band' ? 'esriGeometryEnvelope' : 'esriGeometryPolygon';
  try {
    if (layer === 'roads') {
      const roads = await fetchBackdropLayer({ url: COUNTY_ROADS_URL, clip: geometry, geometryType, tolerance: offset, fields, signal });
      return { collection: roads, features: roads.features.length, source: COUNTY_BACKDROP_SOURCE.roads, tolerance: offset, fields };
    }
    if (layer === 'flood') {
      const zones = await fetchBackdropLayer({ url: COUNTY_FLOOD_URL, clip: geometry, tolerance: offset, fields, signal });
      return { collection: zones, features: zones.features.length, source: COUNTY_BACKDROP_SOURCE.flood, tolerance: offset, fields };
    }
    if (layer === 'neighbourRoads') {
      // THE ROADS OUT THERE, fetched in two steps. First the neighbours themselves - the SAME beats query the districts layer
      // runs, band clip, this station left out - to learn WHICH districts touch ours. Then the major roads inside each of their
      // own outlines, one clipped query per beat, merged and de-duplicated (utils/districtMap#mergeBackdropFeatures). It is not
      // one bigger band because a box around every neighbour truncates at the county's 2,000-record cap; see
      // services/countyGis#neighbourOutlineRings for why per-outline is the shape that actually returns the roads.
      const beats = await fetchBackdropLayer({
        url: COUNTY_FIRE_BEATS_BASE,
        clip: geometry,
        // The band is an ENVELOPE, so this first query is an envelope query exactly like the districts layer's - the roads come
        // second, each clipped to a polygon outline.
        geometryType: 'esriGeometryEnvelope',
        where: neighbourWhere(exclude),
        tolerance: offset,
        fields: [],
        signal,
      });
      const outlines = neighbourOutlineRings(beats);
      // EACH OUTLINE ON ITS OWN, so that ONE the county still refuses cannot sink the layer. The degenerate-ring guard above
      // (ringHasArea) removes the shape that caused the first failure, but a future county generalisation could still produce a
      // ring ArcGIS rejects - and a layer that fetches nine districts' roads and throws away all of them because the tenth
      // outline was bad is a layer nobody can use. So the queries run to completion and only the ones that ANSWERED are kept.
      // If EVERY outline failed there is nothing to keep, and the real reason (the county is down, the filter field is gone)
      // is thrown for the officer to see rather than silently saved as an empty layer. A cancelled press is not a partial
      // result to keep either, so an abort stops here like any other fetch.
      const outcomes = await Promise.allSettled(
        outlines.map((outline) =>
          fetchBackdropLayer({
            url: COUNTY_ROADS_URL,
            clip: outline,
            geometryType: 'esriGeometryPolygon',
            where: NEIGHBOUR_ROAD_WHERE,
            tolerance: offset,
            fields,
            signal,
          })
        )
      );
      if (signal?.aborted) {
        const cancelled = outcomes.find((outcome) => outcome.status === 'rejected');
        throw (cancelled && cancelled.reason) || new Error('The fetch was cancelled.');
      }
      const kept = outcomes.filter((outcome) => outcome.status === 'fulfilled').map((outcome) => outcome.value);
      const failed = outcomes.filter((outcome) => outcome.status === 'rejected');
      if (outlines.length && failed.length === outcomes.length) throw failed[0].reason;
      // Logged rather than shown: one refused polygon of one neighbour is not something a member needs on their screen, but it
      // is something a developer needs when a road that should be there is not.
      if (failed.length) {
        console.warn(
          `[map] ${failed.length} of ${outlines.length} neighbouring outlines were skipped by the county`,
          failed.map((outcome) => outcome.reason?.message || outcome.reason)
        );
      }
      const collection = mergeBackdropFeatures(kept);
      return { collection, features: collection.features.length, source: COUNTY_BACKDROP_SOURCE.neighbourRoads, tolerance: offset, fields };
    }
    if (layer === 'districts') {
      const beats = await fetchBackdropLayer({
        url: COUNTY_FIRE_BEATS_BASE,
        clip: geometry,
        geometryType,
        // The station's own beat is drawn as the boundary, so it is not asked for here at all.
        where: neighbourWhere(exclude),
        tolerance: offset,
        fields,
        signal,
      });
      return { collection: beats, features: beats.features.length, source: COUNTY_BACKDROP_SOURCE.districts, tolerance: offset, fields };
    }
    const [streams, bodies] = await Promise.all([
      fetchBackdropLayer({ url: COUNTY_STREAMS_URL, clip: geometry, tolerance: offset, fields, signal }),
      fetchBackdropLayer({ url: COUNTY_WATER_BODIES_URL, clip: geometry, tolerance: offset, fields, signal }),
    ]);
    return {
      collection: { type: 'FeatureCollection', features: [...streams.features, ...bodies.features] },
      features: streams.features.length + bodies.features.length,
      source: COUNTY_BACKDROP_SOURCE.water,
      tolerance: offset,
      fields,
    };
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("The county's map service could not be reached. Check the connection, or upload the background as a GeoJSON file instead.");
    }
    throw error;
  }
};

