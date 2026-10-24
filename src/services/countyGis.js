// Queries county GIS services to fetch fire district boundaries, roads, waterways, and flood zones.
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
import { getSettingValue } from '../utils/systemSettings.js';

export const DEFAULT_GIS_CONFIG = {
  provider_name: 'Brunswick County GIS',
  fire_beats_url: 'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Brunsco_Ops/FireBeats/FeatureServer/0',
  roads_url: 'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Mapping/DataViewer/MapServer/4',
  streams_url: 'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Basemaps/HydroBaseWebMercator/MapServer/0',
  water_bodies_url: 'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Basemaps/HydroBaseWebMercator/MapServer/1',
  flood_url: 'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Layers/FloodHazards/MapServer/0',
};

// Resolves configured GIS data source URLs from system settings, falling back to Brunswick County defaults.
export const resolveGisConfig = (systemSettings) => {
  const get = (key, fallback) => {
    if (systemSettings && typeof systemSettings === 'object' && !Array.isArray(systemSettings)) {
      if (systemSettings[key] !== undefined && systemSettings[key] !== '') return String(systemSettings[key]).trim();
    }
    return String(getSettingValue(systemSettings, key, '') || '').trim() || fallback;
  };

  return {
    provider_name: get('gis_provider_name', DEFAULT_GIS_CONFIG.provider_name),
    fire_beats_url: get('gis_fire_beats_url', DEFAULT_GIS_CONFIG.fire_beats_url),
    roads_url: get('gis_roads_url', DEFAULT_GIS_CONFIG.roads_url),
    streams_url: get('gis_streams_url', DEFAULT_GIS_CONFIG.streams_url),
    water_bodies_url: get('gis_water_bodies_url', DEFAULT_GIS_CONFIG.water_bodies_url),
    flood_url: get('gis_flood_url', DEFAULT_GIS_CONFIG.flood_url),
  };
};

const COUNTY_FIRE_BEATS_BASE =
  'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Brunsco_Ops/FireBeats/FeatureServer/0';

export const COUNTY_FIRE_BEATS_URL = `${COUNTY_FIRE_BEATS_BASE}/query`;

export const COUNTY_FIRE_BEATS_SOURCE = 'Brunswick County GIS — Brunsco_Ops/FireBeats';

// Base layer URL used to credit and fetch district boundaries.
export const COUNTY_FIRE_BEATS_LAYER = COUNTY_FIRE_BEATS_BASE;

// Maximum time (in ms) to wait for county server responses before timing out.
export const COUNTY_TIMEOUT_MS = 20000;

// Common generic words in fire department names to filter out during searches.
const GENERIC_WORDS = new Set([
  'the', 'of', 'and', 'a',
  'fire', 'department', 'dept', 'volunteer', 'vol', 'rescue', 'ems', 'district', 'station',
  'county', 'city', 'town', 'public', 'safety', 'services', 'service', 'company', 'brigade',
]);

// Extracts the key place name from a department name (e.g. "Bolivia" from "Bolivia Fire Dept").
export const fireBeatSearchTerm = (departmentName) => {
  const words = String(departmentName ?? '')
    .split(/[^\p{L}\p{N}']+/u)
    .map((word) => word.trim())
    .filter(Boolean);
  return words.find((word) => !GENERIC_WORDS.has(word.toLowerCase())) || '';
};

// Escapes single quotes for ArcGIS SQL queries (e.g. O'Brien becomes O''Brien).
export const escapeSqlLiteral = (value) => String(value ?? '').replace(/'/g, "''");

// Builds the query URL to search for fire beats by agency name.
export const fireBeatQueryUrl = ({ search = '', limit = 25, baseUrl = '' } = {}) => {
  const root = String(baseUrl || COUNTY_FIRE_BEATS_BASE).trim().replace(/\/query\/?$/, '');
  const url = `${root}/query`;
  const term = String(search ?? '').trim();
  const where = term ? `UPPER(AgencyID) LIKE '%${escapeSqlLiteral(term.toUpperCase())}%'` : '1=1';
  const params = new URLSearchParams({
    where,
    outFields: 'AgencyID,DisplayName,AgencyAbbrv,Zone,ServiceNum',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
    resultRecordCount: String(limit),
  });
  return `${url}?${params.toString()}`;
};

// Tests whether an ArcGIS service endpoint is reachable and returns valid service metadata.
export const testGisEndpoint = async (url) => {
  const target = String(url || '').trim().replace(/\/query\/?$/, '');
  if (!target) throw new Error('Please enter a service URL to test.');
  const testUrl = target.includes('?') ? `${target}&f=json` : `${target}?f=json`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
  try {
    const res = await fetch(testUrl, { signal: controller?.signal });
    if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Service returned an error');
    return {
      ok: true,
      name: data.name || data.description || data.serviceDescription || 'ArcGIS Service',
      type: data.type || (data.capabilities ? 'Feature/Map Service' : 'Service'),
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Request timed out after 8s. Check the URL and host reachability.');
    throw new Error(err.message || 'Could not connect to service endpoint.');
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// Formats a county map feature into a cleaner fire beat object.
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

export const COUNTY_ROADS_URL =
  'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Mapping/DataViewer/MapServer/4';
export const COUNTY_STREAMS_URL =
  'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Basemaps/HydroBaseWebMercator/MapServer/0';
export const COUNTY_WATER_BODIES_URL =
  'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Basemaps/HydroBaseWebMercator/MapServer/1';
export const COUNTY_FLOOD_URL =
  'https://bcgis.brunswickcountync.gov/arcgis/rest/services/Layers/FloodHazards/MapServer/0';

export const COUNTY_BACKDROP_SOURCE = {
  roads: 'Brunswick County GIS — DataViewer/Roads',
  water: 'Brunswick County GIS — HydroBase/Streams & Water Bodies',
  flood: 'Brunswick County GIS — Layers/FloodHazards (FEMA SFHA)',
  districts: COUNTY_FIRE_BEATS_SOURCE,
  neighbourRoads: 'Brunswick County GIS — DataViewer/Roads (major roads only)',
};

// Geometry simplification tolerances in degrees to reduce file size.
export const COUNTY_BACKDROP_TOLERANCE = { roads: 0.00001, water: 0.00005, flood: 0.0002, districts: 0.00005, neighbourRoads: 0.00005 };

// Converts GeoJSON boundary polygons into ESRI geometry rings format.
export const esriClipFrom = (geojson) => {
  const geometry = boundaryGeometry(geojson);
  if (!geometry) return null;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return { rings: polygons.flat(), spatialReference: { wkid: 4326 } };
};

// Expands a district boundary box by a margin in meters for fetching neighboring areas.
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

// Excludes the station's own department so only neighboring fire districts are fetched.
export const neighbourWhere = (agency) => {
  const name = String(agency ?? '').trim().toUpperCase();
  if (!name) return '1=1';
  return `UPPER(AgencyID) <> '${escapeSqlLiteral(name)}'`;
};

// Checks if a ring has at least 3 distinct corners to form a real polygon.
const ringHasArea = (ring) => {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const corners = new Set(ring.map((point) => (Array.isArray(point) ? `${point[0]},${point[1]}` : '')));
  return corners.size >= 3;
};

// Extracts outer boundary rings for neighboring districts to clip nearby road queries.
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

// Builds request parameters for querying county backdrop layers (roads, water, flood).
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

// Sends a POST query to an ArcGIS service endpoint and parses the GeoJSON features.
const askCounty = async (url, params, signal) => {
  const response = await fetch(`${url}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    console.warn('[map] the county answered', response.status, text.slice(0, 300));
    throw new Error(`The county's map service answered with HTTP ${response.status}. Try again, or upload the background as a GeoJSON file instead.`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("The county's map service answered with something that was not a map. Try again, or upload the background as a GeoJSON file.");
  }
  if (payload && payload.error) {
    throw new Error(`The county's map service refused the query: ${payload.error.message || 'no reason given'}. Try again, or upload the background as a GeoJSON file.`);
  }
  return Array.isArray(payload?.features) ? payload.features : [];
};

// Searches county GIS for fire beats matching a given department or area name.
export const searchFireBeats = async ({ search = '', limit = 25, signal, baseUrl = '' } = {}) => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const onOuterAbort = () => controller?.abort();
  const timer = controller ? setTimeout(() => controller.abort(), COUNTY_TIMEOUT_MS) : null;
  if (signal && controller) signal.addEventListener('abort', onOuterAbort);

  try {
    const response = await fetch(fireBeatQueryUrl({ search, limit, baseUrl }), { signal: controller?.signal });
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

// Fetches a single backdrop layer clipped to specified boundaries.
export const fetchBackdropLayer = async ({ url, clip, geometryType, where, tolerance, fields, signal }) => {
  const features = await askCounty(url, backdropQueryParams({ clip, geometryType, where, tolerance, fields }), signal);
  return { type: 'FeatureCollection', features };
};

// Fetches background geographic layers (roads, water, flood zones, neighboring beats).
export const fetchCountyBackdrop = async ({ layer, clip, band, exclude = '', tolerance, signal, gisConfig = null } = {}) => {
  if (!MAP_BACKDROP_LAYERS.includes(layer)) {
    throw new Error(`There is no map background called "${layer}".`);
  }
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
  const geometryType = clipKind === 'band' ? 'esriGeometryEnvelope' : 'esriGeometryPolygon';

  const beatsUrl = gisConfig?.fire_beats_url || COUNTY_FIRE_BEATS_BASE;
  const roadsUrl = gisConfig?.roads_url || COUNTY_ROADS_URL;
  const floodUrl = gisConfig?.flood_url || COUNTY_FLOOD_URL;
  const streamsUrl = gisConfig?.streams_url || COUNTY_STREAMS_URL;
  const waterBodiesUrl = gisConfig?.water_bodies_url || COUNTY_WATER_BODIES_URL;

  const isCustomProvider = gisConfig?.provider_name && gisConfig.provider_name !== DEFAULT_GIS_CONFIG.provider_name;
  const provider = gisConfig?.provider_name || 'Brunswick County GIS';
  const getSource = (type, defaultSource) => (isCustomProvider ? `${provider} — ${type}` : defaultSource);

  try {
    if (layer === 'roads') {
      const roads = await fetchBackdropLayer({ url: roadsUrl, clip: geometry, geometryType, tolerance: offset, fields, signal });
      return { collection: roads, features: roads.features.length, source: getSource('Roads', COUNTY_BACKDROP_SOURCE.roads), tolerance: offset, fields };
    }
    if (layer === 'flood') {
      const zones = await fetchBackdropLayer({ url: floodUrl, clip: geometry, tolerance: offset, fields, signal });
      return { collection: zones, features: zones.features.length, source: getSource('Flood Hazards (FEMA SFHA)', COUNTY_BACKDROP_SOURCE.flood), tolerance: offset, fields };
    }
    if (layer === 'neighbourRoads') {
      const beats = await fetchBackdropLayer({
        url: beatsUrl,
        clip: geometry,
        geometryType: 'esriGeometryEnvelope',
        where: neighbourWhere(exclude),
        tolerance: offset,
        fields: [],
        signal,
      });
      const outlines = neighbourOutlineRings(beats);
      const outcomes = await Promise.allSettled(
        outlines.map((outline) =>
          fetchBackdropLayer({
            url: roadsUrl,
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
      if (failed.length) {
        console.warn(
          `[map] ${failed.length} of ${outlines.length} neighbouring outlines were skipped by the county`,
          failed.map((outcome) => outcome.reason?.message || outcome.reason)
        );
      }
      const collection = mergeBackdropFeatures(kept);
      return { collection, features: collection.features.length, source: getSource('Roads (major roads only)', COUNTY_BACKDROP_SOURCE.neighbourRoads), tolerance: offset, fields };
    }
    if (layer === 'districts') {
      const beats = await fetchBackdropLayer({
        url: beatsUrl,
        clip: geometry,
        geometryType,
        where: neighbourWhere(exclude),
        tolerance: offset,
        fields,
        signal,
      });
      return { collection: beats, features: beats.features.length, source: getSource('Fire Beats', COUNTY_BACKDROP_SOURCE.districts), tolerance: offset, fields };
    }
    const [streams, bodies] = await Promise.all([
      fetchBackdropLayer({ url: streamsUrl, clip: geometry, tolerance: offset, fields, signal }),
      fetchBackdropLayer({ url: waterBodiesUrl, clip: geometry, tolerance: offset, fields, signal }),
    ]);
    return {
      collection: { type: 'FeatureCollection', features: [...streams.features, ...bodies.features] },
      features: streams.features.length + bodies.features.length,
      source: getSource('HydroBase/Streams & Water Bodies', COUNTY_BACKDROP_SOURCE.water),
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
