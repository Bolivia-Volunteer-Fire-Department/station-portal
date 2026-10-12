import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
// Leaflet's own stylesheet, imported HERE rather than in index.css so it travels in this screen's chunk: a member who never
// opens the map never downloads it. Vite extracts it into the lazy chunk automatically.
import 'leaflet/dist/leaflet.css';
import './DistrictMap.css';
import { AlertCircle, Crosshair, Layers, Loader2, LocateFixed, MapPin, Maximize, Moon, Pencil, Plus, Sun, Trash2, X } from 'lucide-react';
import {
  adminDeleteMapLandmark,
  adminSaveMapLandmark,
  fetchMapBackdrops,
  fetchMapBoundary,
  fetchMapLandmarks,
  fetchMapTypes,
} from '../services/api';
import {
  LANDMARK_LABEL_MAX,
  LANDMARK_NOTE_MAX,
  MAP_BACKDROP_LAYERS,
  MAP_BACKDROP_STYLE,
  backdropStyleFor,
  backdropView,
  boundaryView,
  cacheBackdrops,
  cacheBoundary,
  cacheLandmarks,
  cacheMapTypes,
  cachedBackdrops,
  cachedBoundary,
  cachedLandmarks,
  cachedMapTypes,
  floodZoneColour,
  landmarkFields,
  landmarkProblem,
  neighbourName,
  roadLabels,
  sortedLandmarks,
} from '../utils/districtMap';
// WHAT A PIN CAN BE, and how a kind resolves to it: the station's own list of types, read with everything else on this screen.
import { DEFAULT_MAP_TYPES, mapPinStyle, mapTypeFor, mapTypesView } from '../utils/mapTypes';
import { getCurrentCoordinates } from '../utils/geolocation';
import ConfirmModal from './ConfirmModal';
import DistrictMapDrawing from './DistrictMapDrawing';
import MapTypeGlyph, { glyphHtml } from './MapTypeGlyph';

// THE DISTRICT MAP: the station's own district, as REAL geography - a boundary in latitude and longitude with landmarks
// pinned on it, drawn by Leaflet on a map with no basemap at all.
//
// WHY NO BASEMAP, WHICH LOOKS LIKE A MISSING FEATURE AND IS NOT. A tile layer means somebody else's server in the path of
// the one screen a member might need in a truck with no signal, and it means an API key, a usage policy and a bill that
// belongs to whoever publishes the tiles. The boundary is what the station actually needs to see, and without tiles the map
// draws from two small Firestore reads and works offline. A basemap can be added later as an OPTION - the county publishes
// its own roads and water, and that is the one to use - but nothing in this screen should DEPEND on it.
//
// WHERE THE BOUNDARY COMES FROM: an officer fetches it from the county's open data once (System Settings) and it is COPIED
// into the station's own documents. So the map reads nobody's server but the station's, the day the county retires their
// service is not the day this screen breaks, and the yearly redraw is a button rather than a rebuild. See
// utils/districtMap for the whole argument, and services/countyGis.js for the one-off fetch.
//
// THE TWO VIEWS. This module opens on the real map. A station that has also uploaded a DRAWING gets a second view for it
// (components/DistrictMapDrawing): a sheet has no coordinates in it, so it cannot be pinned or measured - it is a picture of
// a map rather than a map - and it is kept because it may carry detail the boundary does not.

// How the boundary is drawn. A red line and a barely-there fill: the fill is there to make the district read as a SHAPE
// rather than as a fence, and it is faint because the landmarks are drawn on top of it. The dark twin is the same red lifted
// one step, because #b91c1c on near-black muddies into the ground it is meant to stand off.
const BOUNDARY_STYLE = { color: '#b91c1c', weight: 3, fillColor: '#dc2626', fillOpacity: 0.08 };
const BOUNDARY_STYLE_DARK = { color: '#f87171', weight: 3, fillColor: '#ef4444', fillOpacity: 0.14 };

// WHAT A PIN LOOKS LIKE: a disc filled with the type's colour, with its icon in white. A disc rather than Leaflet's default
// marker for a reason that is not style - the default marker is a PNG pulled by a relative URL from Leaflet's stylesheet, which
// 404s under this app's GitHub Pages base path (the classic Leaflet-on-a-subpath bug).
//
// THE STYLE ITSELF COMES FROM utils/mapTypes#mapPinStyle, which is where the fill was lost once: the colour used to be appended
// to a shared string with no semicolon between them, which glued two declarations into one invalid one that the browser dropped
// whole. Two things wear this style - the saved pins and the pin being placed - so it is built once and checked by
// scripts/verify-district-map.
const PIN_SIZE = 22;

// THE PIN BEING PLACED - the one that follows a tap and has not been saved yet - is drawn a little larger with a pale ring, so
// "where the app thinks this is" is never a guess. It is DRAGGABLE at the same time, because a fingertip is not a survey
// instrument: an officer taps roughly and then nudges the pin exactly, which is quicker than tapping again and lands better.
const DRAFT_SIZE = 26;

// Where the map opens when there is nothing to fit to yet: the middle of Brunswick County. A view has to start somewhere,
// and starting at the whole world would make the first paint useless.
const FALLBACK_VIEW = [[34.05, -78.15], 10];
const MAX_PINS_FITTED = 40;

// HOW A ROAD NAME IS DRAWN ON THE ROAD.
//
// Inline styles rather than a stylesheet, because this is the only place in the app that draws text ON a map. A box with a
// border would hide the linework the name belongs to, so the letters carry their own pale halo instead - three shadows in the
// same spot, which is what makes dark text readable over a grey road AND over the red boundary line it may sit on. The outer
// span centres itself on the point; the inner one lies along the road.
const LABEL_BOX = 'position:absolute;transform:translate(-50%,-50%);pointer-events:none';
// THE HALO IS THE THEME: dark text with a pale halo on light ground, pale text with a dark halo on dark. A box with a border
// would hide the linework the name belongs to either way, so the letters carry their own halo instead - three shadows in the
// same spot, which is what makes a name readable over a grey road AND over the red boundary line it may sit on. The outer
// span centres itself on the point; the inner one lies along the road.
const labelTextStyle = (bearing, dark = false) =>
  `display:inline-block;white-space:nowrap;font-size:10px;font-weight:600;letter-spacing:0.02em;color:${dark ? '#e2e8f0' : '#334155'};` +
  `text-shadow:0 0 3px ${dark ? '#0b1220' : '#fff'},0 0 3px ${dark ? '#0b1220' : '#fff'},0 0 3px ${dark ? '#0b1220' : '#fff'};transform:rotate(${Number(bearing || 0).toFixed(1)}deg)`;

// A NAME THAT BELONGS TO AN AREA RATHER THAN TO A LINE - a neighbouring district - so there is no angle to lie at and the text
// sits flat in the middle of its own ground. Same halo, same size, and deliberately the same grey as the road names: a name on
// the map is a name on the map, and the only thing that separates this one from a street is that it is not lying on a line.
const areaTextStyle = (dark = false) =>
  `display:inline-block;white-space:nowrap;font-size:10px;font-weight:600;letter-spacing:0.04em;color:${dark ? '#cbd5e1' : '#475569'};` +
  `text-shadow:0 0 3px ${dark ? '#0b1220' : '#fff'},0 0 3px ${dark ? '#0b1220' : '#fff'},0 0 3px ${dark ? '#0b1220' : '#fff'}`;

// A road name comes from somebody else's database and goes into markup, so it is ESCAPED rather than trusted. The county is
// not going to attack this map - but a name is data, and data that reaches a template unescaped is the whole of that bug class.
const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// WHAT A LAYER CHIP SAYS WHEN THE LAYER HAS SOMETHING WORTH SAYING. The title is where somebody finds out what a layer IS -
// the chips name it, and this answers "and what does it draw?". The road entry is the one whose content is not obvious from
// its name: the names lie along the roads as you zoom in. Nothing here promises tapping, because the background no longer
// answers taps - the names on the ground ARE the answer, which is why this map has no box to pop.
const LAYER_CHIP_FACT = {
  roads: ' — names appear as you zoom in, lying along the roads themselves',
  flood: " — each zone in FEMA's own colour",
  districts: ' — the departments around yours, each named in the middle of its own area',
};

export default function DistrictMap({ token, canEdit = false, isDarkMode }) {
  // THE DEVICE'S COPIES ARE THE FIRST PAINT, not a fallback: a member in a truck with no signal should see the district
  // straight away rather than a spinner that resolves into nothing.
  const [boundaryDoc, setBoundaryDoc] = useState(() => cachedBoundary());
  const [landmarkDocs, setLandmarkDocs] = useState(() => cachedLandmarks());
  // The county's linework, as ONE object because it arrives together and is cached together.
  const [backdropDocs, setBackdropDocs] = useState(() => cachedBackdrops());
  // WHAT A PIN CAN BE, as the station has it. The device's copy first, and the built-in eight when there is nothing stored - so
  // a station that has never edited its types still draws coloured, named pins straight away.
  const [typeDocs, setTypeDocs] = useState(() => cachedMapTypes());
  // Which layers are switched on. ON by default: a station that fetched a layer wants to see it, and the whole design is that
  // it costs nothing to draw (it is already on the device). The landmarks are a layer like any other - a station checking where
  // its boundary runs against a road does not want two hundred pins in the way - and the flood zones are ON for the same
  // reason they are on the county's own viewer: what happens to the ground is as much a part of reading a map as the ground.
  // Hiding any of them must not mean leaving an empty map behind.
  const [layersOn, setLayersOn] = useState({ roads: true, water: true, flood: true, districts: true, neighbourRoads: true, landmarks: true });
  // DARK GROUND, defaulting to the member's own app setting: the canvas is Leaflet's own drawing, so the app's `dark` class
  // never reaches it - the toggle below restyles every drawn element instead. Read once from the document (which App.jsx keeps
  // in step with the user setting over the system one), so the map opens matching the app and the member can still flip just
  // the map - a bright map in a dark app is a torch in a truck at night, and the reverse washes out in daylight.
  const [mapDark, setMapDark] = useState(() => {
    if (typeof isDarkMode === 'boolean') return isDarkMode;
    return typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true;
  });
  const userOverrodeThemeRef = useRef(false);

  // KEEP THE MAP GROUND IN STEP WITH THE APP THEME unless the member explicitly flipped it for this screen.
  useEffect(() => {
    if (!userOverrodeThemeRef.current && typeof isDarkMode === 'boolean') {
      setMapDark(isDarkMode);
    }
  }, [isDarkMode]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      if (!userOverrodeThemeRef.current) {
        setMapDark(document.documentElement.classList.contains('dark'));
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const toggleMapTheme = () => {
    userOverrodeThemeRef.current = true;
    setMapDark((current) => !current);
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('map');
  // The pin being added or edited. `placing` is the state where the NEXT press on the map chooses its position.
  const [draft, setDraft] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const boundary = useMemo(() => boundaryView(boundaryDoc), [boundaryDoc]);
  const landmarks = useMemo(() => sortedLandmarks(landmarkDocs), [landmarkDocs]);
  // THE STATION'S TYPES, ALWAYS USABLE: mapTypesView answers the built-in eight for an empty list, so nothing below has to ask
  // whether the station has edited them yet.
  const types = useMemo(() => mapTypesView(typeDocs), [typeDocs]);
  // A pin's kind resolves to the station's type, and the effects below list this as a dependency - so it is memoised on the list
  // it reads. Without that, every rebuild of the map would be missing a dependency it genuinely uses (`types`), which is the kind
  // of thing that draws yesterday's colours after the station edits its types.
  const typeOf = useCallback((pin) => mapTypeFor(types, pin?.kind), [types]);
  // THE GROUND THE MAP IS ON: one decision every drawn element reads, so a layer added later themes itself by construction.
  // Memoised on the toggle, because the effects that draw list this - and an object rebuilt every render would redraw them all.
  const ground = useMemo(() => backdropStyleFor(mapDark), [mapDark]);
  const boundaryGround = mapDark ? BOUNDARY_STYLE_DARK : BOUNDARY_STYLE;
  // EVERY LAYER THE STATION HAS, viewed - driven by the app's own list rather than naming them, so a layer added to
  // MAP_BACKDROP_LAYERS is drawn, credited and switched by itself instead of being stored and silently ignored.
  const backdrops = useMemo(
    () => Object.fromEntries(MAP_BACKDROP_LAYERS.map((layer) => [layer, backdropView(backdropDocs?.[layer])])),
    [backdropDocs]
  );
  const hasSomething = Boolean(boundary) || landmarks.length > 0;
  // WHO DRAWS WHAT THE MAP SHOWS, in one line, so the credit cannot be forgotten when a layer is added. Leaflet's attribution
  // control is the right home: it is already where "Leaflet" would have gone, and it is where somebody looking at a
  // government boundary expects to find who published it.
  const credits = useMemo(() => {
    const lines = [];
    if (boundary?.source) lines.push(`Boundary: ${boundary.source}`);
    MAP_BACKDROP_LAYERS.forEach((layer) => {
      if (backdrops[layer]?.source) lines.push(`${MAP_BACKDROP_STYLE[layer].label}: ${backdrops[layer].source}`);
    });
    return lines.join(' | ');
  }, [boundary, backdrops]);

  // THE TWO READS, EACH ANSWERING FOR ITSELF. They are independent - a station can have a boundary and no pins, or pins and
  // no boundary while somebody is setting one up - so one failing must not empty the other. `ok: false` means "this read
  // failed, keep whatever is on screen", which is what makes a dropped connection a note rather than a blank map.
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const [boundaryAnswer, pinAnswer, backdropAnswer, typeAnswer] = await Promise.all([
        fetchMapBoundary()
          .then((result) => ({ ok: true, value: result?.mapBoundary ?? null }))
          .catch((err) => ({ ok: false, error: err })),
        fetchMapLandmarks()
          .then((result) => ({ ok: true, value: Array.isArray(result?.mapLandmarks) ? result.mapLandmarks : [] }))
          .catch((err) => ({ ok: false, error: err })),
        // The background: two small documents in one round trip, and the least important of the three - a station with a
        // boundary and pins and no roads should still draw its boundary and pins.
        fetchMapBackdrops()
          .then((result) => ({ ok: true, value: result?.backdrops && typeof result.backdrops === 'object' ? result.backdrops : {} }))
          .catch((err) => ({ ok: false, error: err })),
        // And the smallest of all: one document saying what this station's pins can be. A failure here costs nothing on
        // screen, because the built-in types are what an empty list means.
        fetchMapTypes()
          .then((result) => ({ ok: true, value: result?.mapTypes ?? null }))
          .catch((err) => ({ ok: false, error: err })),
      ]);
      if (cancelled) return;
      if (boundaryAnswer.ok) {
        // Only a real change replaces it: the object's identity is what redraws the boundary layer, and re-adding an
        // identical polygon would flicker the map at the moment the read lands.
        setBoundaryDoc((current) =>
          current && boundaryAnswer.value && current.geojson === boundaryAnswer.value.geojson ? current : boundaryAnswer.value
        );
        cacheBoundary(boundaryAnswer.value);
      }
      if (pinAnswer.ok) {
        setLandmarkDocs(pinAnswer.value);
        cacheLandmarks(pinAnswer.value);
      }
      if (backdropAnswer.ok) {
        setBackdropDocs(backdropAnswer.value);
        cacheBackdrops(backdropAnswer.value);
      }
      if (typeAnswer.ok) {
        setTypeDocs(typeAnswer.value);
        cacheMapTypes(typeAnswer.value);
      }
      // A read that failed leaves the map as it was, and only complains when NOTHING arrived: half a map with the station's own
      // types missing is still a map somebody can use.
      if (!boundaryAnswer.ok && !pinAnswer.ok && !backdropAnswer.ok && !typeAnswer.ok) {
        setError(
          boundaryAnswer.error?.message || pinAnswer.error?.message || backdropAnswer.error?.message || typeAnswer.error?.message || 'The district map could not be read.'
        );
      } else {
        setError('');
      }
      setLoading(false);
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const boundaryLayerRef = useRef(null);
  const pinLayerRef = useRef(null);
  const backdropGroupRef = useRef(null);
  const labelLayerRef = useRef(null);
  // The pin being placed, drawn on its own rather than with the saved pins: it is rebuilt whenever the draft changes, and
  // rebuilding every pin on the map for one keystroke in the form would be the expensive way round.
  const draftLayerRef = useRef(null);
  // Whether the view has been fitted to something yet. Fitting is what the member wants ONCE - after that it is their map,
  // and re-fitting it every time a pin is saved would snatch the view away from wherever they were looking.
  const fittedRef = useRef(false);
  // The boundary's source line, as currently credited, so the same sentence is not added twice.
  const attributionRef = useRef('');

  // ---- the map ----------------------------------------------------------------------------------
  useEffect(() => {
    if (view !== 'map' || !containerRef.current) return undefined;
    const map = L.map(containerRef.current, {
      minZoom: 8,
      maxZoom: 21,
      // Half steps: a district is a few kilometres across, and whole steps are coarse when somebody is hunting for the shed
      // a hydrant is behind.
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      attributionControl: true,
    });
    mapRef.current = map;
    // Our own words rather than Leaflet's default prefix, which links to a website about a project nobody here has heard
    // of. The credit stays: Leaflet is doing the drawing, and the county is credited below when their line is on the map.
    map.attributionControl.setPrefix('');
    map.setView(FALLBACK_VIEW[0], FALLBACK_VIEW[1]);
    fittedRef.current = false;

    return () => {
      map.remove();
      mapRef.current = null;
      boundaryLayerRef.current = null;
      pinLayerRef.current = null;
      backdropGroupRef.current = null;
      labelLayerRef.current = null;
      fittedRef.current = false;
      attributionRef.current = '';
    };
  }, [view]);

  // ---- the boundary -----------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (boundaryLayerRef.current) {
      boundaryLayerRef.current.remove();
      boundaryLayerRef.current = null;
    }
    if (boundary) {
      boundaryLayerRef.current = L.geoJSON(boundary.geometry, { style: () => boundaryGround }).addTo(map);
    }
    if (boundary && !fittedRef.current) {
      map.fitBounds(boundary.bounds, { padding: [28, 28] });
      fittedRef.current = true;
    }
  }, [boundary, boundaryGround, view]);

  // ---- the background: the county's own linework -------------------------------------------------
  //
  // DRAWN FROM THE STATION'S OWN COPY, not from the county: by the time this runs the geometry is already on the device (or
  // in its records), so this is a local draw at any zoom with no network at all. That is the whole reason the background is
  // copied rather than tiled, and it is what makes it work in a truck.
  //
  // DRAWN IN THE ORDER THE CHIPS READ, because within one pane whatever is added last is drawn last, and the order is the
  // point: the flood wash at the bottom (it is a fact about the ground, and everything else is read through it), then the
  // water, then the major roads out in the neighbours (quiet context, so OUR roads can be the darker line over them), then
  // our own roads - two passes, a pale casing under a grey line - and the neighbouring districts on top, because their dashed
  // lines are the only drawing on this map that says "not ours", and a road drawn over them would hide it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (backdropGroupRef.current) {
      backdropGroupRef.current.remove();
      backdropGroupRef.current = null;
    }
    const group = L.layerGroup().addTo(map);
    backdropGroupRef.current = group;
    // LEAFLET'S OWN TILE PANE, which is the pane for background imagery and sits below the overlay pane that holds the
    // boundary and the pins. Using its layer order rather than a pane of our own is deliberate on two counts: it states the
    // order with the library's own vocabulary instead of a number, and the app holds itself to having no raw z-index outside
    // one measured place (see scripts/verify-schedule-drop.mjs), which a custom pane would have broken. Nothing else uses
    // this pane - the app has no tiles - so it is free.
    const pane = 'tilePane';

    // THE FLOOD ZONES, first, so everything else is read through them. Each polygon is drawn in FEMA's own colour for its zone
    // (utils/districtMap#floodZoneColour), which is the one place on this map where a colour carries a fact rather than an
    // identity - and the colour IS the whole of the answer, so there is nothing to tap for: the wash is not interactive and
    // binds no tooltip, because a tap that popped a box repeating the zone would be noise over a name the wash already states.
    const flood = layersOn.flood ? backdrops.flood : null;
    if (flood) {
      L.geoJSON(flood.collection, {
        pane,
        interactive: false,
        // The colour is asked for PER FEATURE, which is what makes one layer five colours - and the outline is carried in the
        // same colour at a hair's width, because a zone edge is real but is not a line anybody drives along.
        style: (feature) => {
          const colour = floodZoneColour(feature?.properties);
          return {
            color: colour,
            weight: ground.flood.width,
            fillColor: colour,
            fillOpacity: ground.flood.fillOpacity,
            lineJoin: 'round',
          };
        },
      }).addTo(group);
    }

    const water = layersOn.water ? backdrops.water : null;
    if (water) {
      L.geoJSON(water.collection, {
        pane,
        interactive: false,
        style: () => ({
          color: ground.water.color,
          weight: ground.water.width,
          fillColor: ground.water.fill,
          fillOpacity: ground.water.fillOpacity,
          lineJoin: 'round',
        }),
      }).addTo(group);
    }

    const roads = layersOn.roads ? backdrops.roads : null;
    if (roads) {
      // NOT INTERACTIVE, deliberately: the road's name lies along the road itself as a label (drawn in the effect below), so a
      // tap that popped a box would repeat what the ground already says - and a line that took clicks would swallow the press
      // that places a landmark. The casing first, then the line: within one pane, whatever is added last is drawn last.
      L.geoJSON(roads.collection, {
        pane,
        interactive: false,
        style: () => ({
          color: ground.roads.casing,
          weight: ground.roads.casingWidth,
          lineCap: 'round',
          lineJoin: 'round',
          fill: false,
        }),
      }).addTo(group);
      L.geoJSON(roads.collection, {
        pane,
        interactive: false,
        style: () => ({
          color: ground.roads.color,
          weight: ground.roads.width,
          lineCap: 'round',
          lineJoin: 'round',
          fill: false,
        }),
      }).addTo(group);
    }

    // THE ROADS OUT IN THE NEIGHBOURING DISTRICTS, drawn under the districts but over our own roads. These come from the same
    // county road layer, just fetched across the beats around us instead of inside our own band - so they are drawn the same
    // way (a pale casing under a grey line) but with the neighbourRoads style, which is the same idea one step dimmer so our own
    // roads read first. NOT INTERACTIVE either: the names lie along the roads as labels like our own, so a box on tap would be
    // the same noise twice over.
    const neighbourRoads = layersOn.neighbourRoads ? backdrops.neighbourRoads : null;
    if (neighbourRoads) {
      L.geoJSON(neighbourRoads.collection, {
        pane,
        interactive: false,
        style: () => ({
          color: ground.neighbourRoads.casing,
          weight: ground.neighbourRoads.casingWidth,
          lineCap: 'round',
          lineJoin: 'round',
          fill: false,
        }),
      }).addTo(group);
      L.geoJSON(neighbourRoads.collection, {
        pane,
        interactive: false,
        style: () => ({
          color: ground.neighbourRoads.color,
          weight: ground.neighbourRoads.width,
          lineCap: 'round',
          lineJoin: 'round',
          fill: false,
        }),
      }).addTo(group);
    }

    // THE DISTRICTS AROUND THIS ONE, drawn last so nothing covers the dashed line that says "not ours". Two things are drawn
    // from each feature: the outline and its faint fill, and the county's own name for the beat in the middle of its own ground.
    //
    // OUR OWN BEAT IS DROPPED ON THE WAY IN, which is belt as well as braces. The fetch already asks the county to leave this
    // station's department out (services/countyGis#neighbourWhere), but a boundary that arrived as an UPLOADED FILE has no
    // agency for the county to match - and printing this station's own name in the middle of its own district, in the layer
    // whose whole meaning is "somebody else", is the kind of wrong that reads as a fact.
    const districts = layersOn.districts ? backdrops.districts : null;
    if (districts) {
      const ours = boundary ? boundary.label : '';
      L.geoJSON(districts.collection, {
        pane,
        // NOT INTERACTIVE, deliberately. The beat's whole name is already printed in the middle of its own ground by the marker
        // below, so there is nothing left to ask of the shape - and a fill that took clicks would (a) risk popping a box with
        // nothing in it and (b) swallow the press that places a landmark. The name on the ground IS the answer.
        interactive: false,
        filter: (feature) => !ours || neighbourName(feature?.properties) !== ours,
        onEachFeature: (feature, layer) => {
          // The middle of the polygon's own box, which is a good guess rather than a measurement: a beat that wraps around
          // another one has a centre that lands somewhere unexpected. The name is a hint on the map and the tap is the answer.
          const name = neighbourName(feature?.properties);
          if (name && typeof layer.getBounds === 'function') {
            L.marker(layer.getBounds().getCenter(), {
              pane: 'shadowPane',
              interactive: false,
              keyboard: false,
              icon: L.divIcon({
                className: '',
                html: `<span style="${LABEL_BOX}"><span style="${areaTextStyle(mapDark)}">${escapeHtml(name)}</span></span>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              }),
            }).addTo(group);
          }
        },
        style: () => ({
          color: ground.districts.color,
          weight: ground.districts.width,
          dashArray: ground.districts.dash,
          fillColor: ground.districts.fill,
          fillOpacity: ground.districts.fillOpacity,
          lineJoin: 'round',
        }),
      }).addTo(group);
    }
    // The background is NOT interactive - no layer in it answers taps - so `placing` is not in the list: arming a landmark
    // needs no cooperation from lines that take no clicks. `boundary` because the neighbouring districts are filtered against it.
    // `ground` and `mapDark` because every colour above is read from them: flipping the toggle redraws the ground it stands on.
  }, [backdrops, boundary, ground, layersOn, mapDark, view]);

  // ---- the road names ---------------------------------------------------------------------------
  //
  // LABELS ARE DRAWN ONLY WHERE A NAME FITS, which is arithmetic rather than taste (utils/districtMap#roadLabels): a name needs
  // about sixty pixels of road to lie on, and how many metres that is depends on the zoom. At district scale almost nothing
  // qualifies; zoomed into a neighbourhood, the streets appear. ONE LABEL PER NAME, on the longest stretch carrying it -
  // the county breaks a road at every junction, so a label per feature would print "OLD OCEAN HWY" a dozen times.
  //
  // BOTH ROAD LAYERS FEED ONE CALL, because a name does not stop at the district line: a highway that runs through both would
  // otherwise get a label in each, printed twice along one road. A layer whose switch is off contributes nothing, so hiding the
  // nearby roads hides their names too rather than leaving orphan labels on bare ground.
  //
  // They are redrawn when the zoom settles rather than on every frame, and they are drawn in Leaflet's SHADOW PANE, which is
  // the rung of Leaflet's own ladder between the boundary and the pins:
  //
  //     tile 200 (roads and waterways) < overlay 400 (the boundary) < SHADOW 500 (the names) < marker 600 (the pins)
  //     < tooltip 650 (a pin's name) < popup 700
  //
  // THE NAMES USED TO LIVE IN THE TOOLTIP PANE, and that was the bug the ladder above prevents: a pin's name is ALSO a tooltip,
  // so the two were in the same pane, and within one pane what is added last is drawn last. The names are rebuilt on every zoom,
  // so they were always added last - which meant a landmark's own name was painted UNDER whatever street name happened to be
  // near it. Any rung above the boundary and below the tooltips fixes it; the shadow pane is the one already there, and the app
  // draws its own shadows in CSS, so nothing else is using it.
  useEffect(() => {
    const map = mapRef.current;
    const clear = () => {
      if (labelLayerRef.current) {
        labelLayerRef.current.remove();
        labelLayerRef.current = null;
      }
    };
    const roadFeatures = [
      ...(layersOn.roads && backdrops.roads ? backdrops.roads.collection?.features || [] : []),
      ...(layersOn.neighbourRoads && backdrops.neighbourRoads ? backdrops.neighbourRoads.collection?.features || [] : []),
    ];
    if (!map || roadFeatures.length === 0) {
      clear();
      return undefined;
    }
    const draw = () => {
      clear();
      const group = L.layerGroup().addTo(map);
      labelLayerRef.current = group;
      const centre = map.getCenter();
      roadLabels({ features: roadFeatures }, map.getZoom(), centre.lat).forEach((label) => {
        L.marker(label.at, {
          pane: 'shadowPane',
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: '',
            // A span that centres itself on the point, holding a span rotated to lie along the road. The name is ESCAPED
            // because it is data from somebody else's database and this is markup.
            html: `<span style="${LABEL_BOX}"><span style="${labelTextStyle(label.bearing, mapDark)}">${escapeHtml(label.name)}</span></span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
        }).addTo(group);
      });
    };
    draw();
    map.on('zoomend', draw);
    return () => {
      map.off('zoomend', draw);
      clear();
    };
  }, [backdrops, layersOn, mapDark, view]);

  // ---- who gets the credit ----------------------------------------------------------------------
  //
  // Leaflet's attribution control APPENDS, so a line that changes (a boundary re-read after a save, a background fetched
  // later) would otherwise be printed again beside itself. The previous lines are taken back before the new one is added.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const control = map.attributionControl;
    if (attributionRef.current) {
      attributionRef.current.split(' | ').forEach((line) => control.removeAttribution(line));
    }
    if (credits) {
      credits.split(' | ').forEach((line) => control.addAttribution(line));
    }
    attributionRef.current = credits;
  }, [credits, view]);

  // ---- the landmarks ----------------------------------------------------------------------------
  //
  // EVERY pin is drawn rather than the ones in view: the whole point of this screen is where the water is, and Leaflet keeps a
  // marker per pin cheap - a station with a pin per hydrant is a few hundred, and the read is capped for the same reason
  // (utils/districtMap).
  //
  // A PIN IS A DISC WITH ITS TYPE'S ICON IN IT, not the plain circle it used to be, and the icon is drawn as inline SVG rather
  // than as an image: a marker that loads a PNG by URL 404s under this app's base path (the classic Leaflet-on-a-subpath bug),
  // and the glyphs have to read against the map's own colours. See components/MapTypeGlyph for the same icon in the legend.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pinLayerRef.current) pinLayerRef.current.remove();
    // SWITCHED OFF MEANS NOT DRAWN, not drawn and hidden: a station with 500 pins pays nothing for a layer it has turned off.
    if (!layersOn.landmarks) {
      pinLayerRef.current = null;
      return;
    }
    const group = L.layerGroup().addTo(map);
    pinLayerRef.current = group;
    landmarks.forEach((pin) => {
      const type = typeOf(pin);
      const selected = pin.id === selectedId;
      // The selected pin is drawn larger with a ring, so the map agrees with the list about which pin is being edited. The ring
      // is the ground's own colour (pale on light, near-black on dark), because a white ring on a dark map would blaze.
      const size = selected ? PIN_SIZE + 6 : PIN_SIZE;
      const ring = selected ? `box-shadow:0 0 0 2px ${mapDark ? '#0b1220' : '#fff'},0 0 0 4px ${type.color};` : '';
      const marker = L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({
          className: '',
          html: `<span style="${mapPinStyle(type.color, ring)}">${glyphHtml(type.icon, {
            size: Math.round(size * 0.62),
          })}</span>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
      });
      marker.bindTooltip(pin.label, { direction: 'top', offset: [0, -size / 2 - 4] });
      // A press selects the pin in the LIST below rather than opening a popup: the list is where it can be edited, and a
      // popup full of buttons would have to be built as HTML by hand - which is how a landmark's own name becomes markup.
      marker.on('click', () => setSelectedId(pin.id));
      marker.addTo(group);
    });

    // With no boundary to fit to, the pins are what the map is about. ONE pin is fitted differently, because fitBounds on a
    // single point zooms to the maximum and shows nothing but that neighbourhood.
    if (!fittedRef.current && !boundary) {
      if (landmarks.length === 1) {
        map.setView([landmarks[0].lat, landmarks[0].lng], 15);
        fittedRef.current = true;
      } else if (landmarks.length > 1 && landmarks.length <= MAX_PINS_FITTED) {
        map.fitBounds(L.latLngBounds(landmarks.map((pin) => [pin.lat, pin.lng])), { padding: [48, 48] });
        fittedRef.current = true;
      }
    }
    // `selectedId` is in the list because the selected pin is drawn differently: without it the map would keep showing the ring
    // on whichever pin was selected first. `layersOn` because the layer can be switched off from the chips under the map, and
    // `typeOf` because that is how a kind becomes a colour and an icon. `mapDark` because the selected ring is the ground's
    // colour, so flipping the toggle redraws it.
  }, [landmarks, boundary, mapDark, view, selectedId, types, typeOf, layersOn.landmarks]);

  // ---- the pin being placed ----------------------------------------------------------------------
  //
  // THE PIN THAT FOLLOWS A TAP. Until this existed, a tap recorded a position and showed nothing: the officer could not see
  // where the app thought the point was, could not tell whether the tap had registered at all, and only found out where the
  // landmark had landed after saving it. It is drawn from the same type, so it previews the colour and icon too.
  //
  // IT IS DRAGGABLE, which is the part that makes placing precise rather than merely visible: a fingertip covers ~40px of a
  // phone screen (that is the size of the thing you are trying to point at), so tapping once and nudging is both faster and
  // more accurate than tapping again - and it is the same gesture the map already uses for its own features.
  useEffect(() => {
    const map = mapRef.current;
    if (draftLayerRef.current) {
      draftLayerRef.current.remove();
      draftLayerRef.current = null;
    }
    if (!map || view !== 'map' || !draft) return;
    if (!Number.isFinite(draft.lat) || !Number.isFinite(draft.lng)) return;
    const type = typeOf(draft);
    const marker = L.marker([draft.lat, draft.lng], {
      // Dragging is the whole point, and `autoPan` is what makes it usable at the edge of the screen: without it, a pin being
      // dragged towards the corner runs out of map to be dragged onto.
      draggable: true,
      autoPan: true,
      icon: L.divIcon({
        className: '',
        // A ring in the ground's own colour around the draft pin's own colour, so the pin being placed is unmistakably the one
        // that moves - pale on light, near-black on dark.
        html: `<span style="${mapPinStyle(type.color, `box-shadow:0 0 0 2px ${mapDark ? '#0b1220' : '#fff'},0 0 0 5px ${type.color}80;`)}">${glyphHtml(
          type.icon,
          { size: Math.round(DRAFT_SIZE * 0.62) }
        )}</span>`,
        iconSize: [DRAFT_SIZE, DRAFT_SIZE],
        iconAnchor: [DRAFT_SIZE / 2, DRAFT_SIZE / 2],
      }),
      // Above the saved pins, so the pin being placed is never hidden behind one already there.
      zIndexOffset: 1000,
    });
    marker.bindTooltip('Drag to adjust', { direction: 'top', offset: [0, -DRAFT_SIZE / 2 - 4] });
    // DRAGGING WRITES THE POSITION BACK TO THE DRAFT, which is what the form's coordinates and the save both read - so there is
    // one answer to "where is this landmark" rather than a marker that has drifted from the form.
    marker.on('dragend', () => {
      const at = marker.getLatLng();
      setDraft((current) => (current ? { ...current, lat: at.lat, lng: at.lng } : current));
    });
    marker.addTo(map);
    draftLayerRef.current = marker;
    // `mapDark` because the draft ring is the ground's colour too.
  }, [draft, mapDark, view, types, typeOf]);

  // ---- placing a pin ----------------------------------------------------------------------------
  //
  // ONE PRESS TO ARM, ONE PRESS ON THE MAP TO PLACE. Arming first is what makes this usable on a phone: while a member is
  // just looking around, a tap on the map must mean "look there" - and it only means "put it here" once somebody has said
  // they are placing something.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !placing) return undefined;
    const container = map.getContainer();
    const place = (event) => {
      setDraft((current) => (current ? { ...current, lat: event.latlng.lat, lng: event.latlng.lng } : current));
      setPlacing(false);
    };
    map.on('click', place);
    container.style.cursor = 'crosshair';
    return () => {
      map.off('click', place);
      container.style.cursor = '';
    };
    // `view` is in the list so that switching to the drawing and back re-attaches the handler to the NEW map: without it an
    // officer who armed "press the map" before switching tabs would see the prompt and find the map unresponsive.
  }, [placing, view]);

  const startAdd = () => {
    setSelectedId('');
    setError('');
    // A new pin starts on the station's FIRST type rather than on a hard-coded one: the list is theirs, and the first entry is
    // the one they put first.
    setDraft({ id: '', label: '', kind: types[0]?.key || DEFAULT_MAP_TYPES[0].key, note: '', lat: null, lng: null });
    setPlacing(true);
  };

  const startEdit = (pin) => {
    setError('');
    setDraft({ id: pin.id, label: pin.label, kind: pin.kind, note: pin.note, lat: pin.lat, lng: pin.lng });
    setPlacing(false);
  };

  const cancelDraft = () => {
    setDraft(null);
    setPlacing(false);
  };

  // STANDING NEXT TO THE THING is how most landmarks get placed, so the device's own position is offered as a button rather
  // than typed in. It asks for permission only when pressed, and a refusal is answered with the alternative.
  const useMyPosition = async () => {
    setLocating(true);
    setError('');
    const at = await getCurrentCoordinates();
    setLocating(false);
    if (!Number.isFinite(at?.latitude) || !Number.isFinite(at?.longitude)) {
      setError('This device could not work out where it is, so the landmark has not been moved. Choose the place on the map instead.');
      return;
    }
    setDraft((current) => (current ? { ...current, lat: at.latitude, lng: at.longitude } : current));
    setPlacing(false);
  };

  const saveDraft = async () => {
    const problem = landmarkProblem(draft || {});
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const fields = landmarkFields(draft);
      const result = await adminSaveMapLandmark({ id: draft.id, fields }, token);
      if (!result || !result.success) throw new Error((result && result.message) || 'Failed to save the landmark.');
      // UPDATED FROM WHAT WAS SENT, not from a re-read: the id is the only thing the server decides, and reading the whole
      // list back to learn it would be a round trip for something already in hand. A stored row also carries stamps, which
      // are not drawn.
      const id = draft.id || result.id;
      const next = [...landmarkDocs.filter((pin) => pin.id !== id), { id, ...fields }];
      setLandmarkDocs(next);
      cacheLandmarks(next);
      setSelectedId(id);
      setDraft(null);
      setPlacing(false);
    } catch (err) {
      setError(err?.message || 'Failed to save the landmark.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const pin = pendingDelete;
    setPendingDelete(null);
    if (!pin) return;
    setSaving(true);
    setError('');
    try {
      const result = await adminDeleteMapLandmark(pin.id, token);
      if (!result || !result.success) throw new Error((result && result.message) || 'Failed to remove the landmark.');
      const next = landmarkDocs.filter((row) => row.id !== pin.id);
      setLandmarkDocs(next);
      cacheLandmarks(next);
      if (selectedId === pin.id) setSelectedId('');
    } catch (err) {
      setError(err?.message || 'Failed to remove the landmark.');
    } finally {
      setSaving(false);
    }
  };

  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;
    if (boundary) {
      map.fitBounds(boundary.bounds, { padding: [28, 28] });
      return;
    }
    if (landmarks.length) {
      map.fitBounds(L.latLngBounds(landmarks.map((pin) => [pin.lat, pin.lng])), { padding: [48, 48] });
      return;
    }
    map.setView(FALLBACK_VIEW[0], FALLBACK_VIEW[1]);
  };

  // Choosing a landmark in the list BOTH marks it and takes the map to it: a panel of pin names beside a map is a panel of
  // names until the map agrees which one is meant.
  const selectOnMap = (pin) => {
    setSelectedId(pin.id);
    const map = mapRef.current;
    if (map) map.panTo([pin.lat, pin.lng]);
  };

  // The types actually on this station's map, in the order the station's own list declares them - a legend that only shows what
  // is there, rather than colours for things this district has none of.
  const usedTypes = types.filter((type) => landmarks.some((pin) => pin.kind === type.key));
  // A pin whose type was removed still draws as the fallback, so the legend has to be able to say so.
  const orphanCount = landmarks.filter((pin) => pin.kind && !types.some((type) => type.key === pin.kind)).length;

  // THE VIEW SWITCHER IS ONE SEGMENTED CONTROL rather than two loose pills: they are two views of the SAME map, and drawn as
  // separate buttons they read as two actions - which is how they ended up half a row apart from the buttons that ARE actions.
  // On a phone the control takes the row and the halves are equal, so the row is not left ragged in the middle.
  const viewTab = (id, label, Icon) => (
    <button
      type="button"
      onClick={() => setView(id)}
      aria-pressed={view === id}
      className={`inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] px-3 py-2 text-sm font-medium transition sm:flex-none ${
        view === id
          ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  // THE ROW'S ACTION BUTTONS, which are a different kind of thing from the switcher above and so are laid out as a row of their
  // own: full-width halves on a phone (thumb-sized targets, nothing ragged), auto-width and pushed right on a wide screen.
  const actionButton = 'inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition sm:flex-none';

  return (
    <div className="space-y-4">
      {/* A phone stacks this into two clean rows - the switcher, then the actions - and a wide screen puts them on one line with
          the actions pushed right. The old layout let `ml-auto` right-align a wrapped row, which left the second row starting
          in the middle of the screen with a gap above the map. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex w-full items-center gap-1 rounded-xl border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800 sm:w-auto">
          {viewTab('map', 'The district', MapPin)}
          {viewTab('drawing', 'Drawing', Layers)}
        </div>
        {/* Only drawn when the map view has actions to put in it: an empty full-width row would still add the row gap above the
            map on a phone when the Drawing tab - which has no actions - is open. */}
        {view === 'map' ? (
          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            {canEdit && !draft ? (
              <button
                type="button"
                onClick={startAdd}
                className={`${actionButton} bg-red-600 text-white shadow-lg shadow-red-600/20 hover:bg-red-500`}
              >
                <Plus className="h-4 w-4" />
                Add landmark
              </button>
            ) : null}
            <button
              type="button"
              onClick={resetView}
              className={`${actionButton} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700`}
            >
              <Maximize className="h-4 w-4" />
              Reset view
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {error}
            {hasSomething ? ' What is on screen is the copy saved on this device.' : ''}
          </p>
        </div>
      ) : null}

      {loading && view === 'map' ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading the district map…</span>
        </div>
      ) : null}

      {view === 'drawing' ? (
        <DistrictMapDrawing token={token} />
      ) : (
        <>
          {boundary ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-200">{boundary.label || 'District boundary'}</span>
              {boundary.zone ? ` · beat ${boundary.zone}` : ''}
              {` · ${boundary.points.toLocaleString()} points`}
              {boundary.updated_at ? ` · set ${boundary.updated_at}` : ''}
            </p>
          ) : null}

          {/* WHAT IS DRAWN ON THE MAP: switchable, and shown only for the layers this station actually has. A chip per layer
              rather than a preference buried elsewhere, because this is about what is on screen - and the map is where that is
              decided.
              
              THE LANDMARKS ARE A LAYER TOO, and the row is called "Layers" rather than "Background" for that reason: hiding the
              pins is how an officer sees where a boundary runs against a road, and it is the one toggle that changes what the
              map is FOR rather than what is under it. */}
          {/* WHAT IS DRAWN ON THE MAP: switchable, and shown only for the layers this station actually has.
              THE MAP GROUND TOGGLE is always available here so the member can switch between daylight and night ground. */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {MAP_BACKDROP_LAYERS.some((layer) => backdrops[layer]) || landmarks.length ? (
                <>
                  <span className="font-medium text-slate-500 dark:text-slate-400">Layers</span>
                  {MAP_BACKDROP_LAYERS.filter((layer) => backdrops[layer]).map((layer) => {
                    const style = ground[layer];
                    const on = layersOn[layer];
                    return (
                      <button
                        key={layer}
                        type="button"
                        aria-pressed={on}
                        title={
                          `${backdrops[layer].features.toLocaleString()} ${style.label.toLowerCase()}, ${backdrops[layer].points.toLocaleString()} points` +
                          // The layers with something to SAY get it in the chip, so the answer is where the question is asked.
                          (LAYER_CHIP_FACT[layer] || '')
                        }
                        onClick={() => setLayersOn((current) => ({ ...current, [layer]: !current[layer] }))}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition ${
                          on
                            ? 'border-slate-300 bg-white text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100'
                            : 'border-slate-200 bg-transparent text-slate-400 dark:border-slate-700 dark:text-slate-500'
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: style.color, opacity: on ? 1 : 0.4 }}
                        />
                        {style.label}
                      </button>
                    );
                  })}
                  {landmarks.length ? (
                    <button
                      type="button"
                      aria-pressed={layersOn.landmarks}
                      // A pin rather than a coloured dot, because the pins are coloured by TYPE - one dot here would be a lie about
                      // which landmark it stands for.
                      title={`${landmarks.length.toLocaleString()} landmark${landmarks.length === 1 ? '' : 's'}, each drawn with its type's icon and colour`}
                      onClick={() => setLayersOn((current) => ({ ...current, landmarks: !current.landmarks }))}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition ${
                        layersOn.landmarks
                          ? 'border-slate-300 bg-white text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100'
                          : 'border-slate-200 bg-transparent text-slate-400 dark:border-slate-700 dark:text-slate-500'
                      }`}
                    >
                      <MapPin className="h-3 w-3" style={{ opacity: layersOn.landmarks ? 1 : 0.4 }} />
                      Landmarks
                    </button>
                  ) : null}
                </>
              ) : boundary ? (
                <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-red-600" />
                  Boundary active
                </span>
              ) : null}
            </div>

            {/* DARK GROUND, beside the layers because it is about what is on screen - and it defaults to the member's own app
                setting (read from the document on open), so the map arrives matching the app. A chip rather than a buried
                preference: a bright map in a dark truck is a torch, and daylight washes a dark one out, so this is flipped in
                the moment rather than set once. */}
            <button
              type="button"
              aria-pressed={mapDark}
              title={mapDark ? 'Dark ground active — press for the light map' : 'Light ground active — press for the dark map'}
              onClick={toggleMapTheme}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition shadow-xs sm:ml-auto ${
                mapDark
                  ? 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'
              }`}
            >
              {mapDark ? <Moon className="h-3 w-3 text-cyan-400" /> : <Sun className="h-3 w-3 text-amber-500" />}
              <span>{mapDark ? 'Dark map' : 'Light map'}</span>
            </button>
          </div>

          {!hasSomething && !loading && !error ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl dark:border-slate-700 dark:bg-slate-800">
              <MapPin className="mx-auto h-8 w-8 text-slate-400" />
              <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">No district boundary set yet</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500 dark:text-slate-400">
                {canEdit
                  ? 'Set it from Administration → System → Map Settings: it can be fetched straight from the county\'s own data, or uploaded as a GeoJSON file. Landmarks can be added here in the meantime — press Add landmark and then the place on the map.'
                  : 'An officer can set the district boundary and add landmarks from Administration → System → Map Settings.'}
              </p>
            </div>
          ) : null}

          {/* THE MAP IS ALWAYS HERE, even with nothing on it - and that is not just so the screen has no empty hole. A station
              with no boundary yet still needs a map to place its FIRST landmark on, and the officer doing that is exactly
              the person looking at this empty state.

              THE PLACING HINT IS AN OVERLAY INSIDE THIS CARD, and that is a bug fix rather than a style choice. It used to be a
              strip BELOW the map, added when placement was armed and removed the instant the map was tapped - which made the
              page 44px shorter at the exact moment the pin was placed. On a phone, scrolled to the bottom, the browser clamps
              the scroll as the page shrinks, so the whole map slid up under the officer's finger: the pin landed where they
              tapped and LOOKED 40px too high. An overlay changes no layout, so the map cannot move. It is `pointer-events-none`
              so the taps still reach the map underneath it. */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-xl dark:border-slate-700">
            {/* `relative z-0 isolate` is not decoration: Leaflet's panes carry raw z-indexes in the hundreds, which would
                otherwise sit ON TOP of the app's own header and sidebar. The stacking context keeps the map in its card - and
                it is also what lets the hint below sit above every pane at a page-level z-10 rather than a pane-level one. */}
            <div
              ref={containerRef}
              className={`station-district-map relative z-0 isolate h-[60vh] min-h-[320px] w-full transition-colors duration-200 ${
                mapDark ? 'station-map-dark bg-[#0b1220]' : 'bg-slate-100'
              }`}
            />
            {placing ? (
              <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50/95 p-2.5 text-sm font-medium text-red-800 shadow-lg dark:border-red-500/40 dark:bg-red-950/90 dark:text-red-200">
                <Crosshair className="h-4 w-4 shrink-0 animate-pulse" />
                <span>Press the map where the landmark is — then drag the pin if it needs nudging.</span>
              </div>
            ) : null}
          </div>

          {/* THE FORM, which is also the "move it" mode. The position is shown as two numbers an officer can read back to
              somebody, and it is chosen either on the map or from the device they are standing with. */}
          {draft ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveDraft();
              }}
              className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex items-center gap-2">
                {/* The type's own disc and glyph, which is the same thing the map is drawing at that moment. */}
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ background: typeOf(draft).color }}
                >
                  <MapTypeGlyph icon={typeOf(draft).icon} size={14} />
                </span>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {draft.id ? 'Edit landmark' : 'New landmark'}
                </h3>
                <button
                  type="button"
                  onClick={cancelDraft}
                  aria-label="Cancel"
                  className="ml-auto rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Name</span>
                  <input
                    value={draft.label}
                    maxLength={LANDMARK_LABEL_MAX}
                    onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                    placeholder="Hydrant 12"
                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>
              </div>

              {/* THE TYPE PICKER IS A GRID OF BUTTONS RATHER THAN A DROPDOWN, because each type IS its icon and its color: a
                  select can only show names, so the one place somebody chooses a type would be the one place they cannot see
                  what they are choosing. */}
              <div>
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Type</span>
                <div className="flex flex-wrap gap-1.5">
                  {types.map((type) => {
                    const on = draft.kind === type.key;
                    return (
                      <button
                        key={type.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setDraft((current) => ({ ...current, kind: type.key }))}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs font-medium transition ${
                          on
                            ? 'border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-500 dark:bg-slate-700 dark:text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                        }`}
                      >
                        <span
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                          style={{ background: type.color }}
                        >
                          <MapTypeGlyph icon={type.icon} size={10} />
                        </span>
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Note (optional)
                </span>
                <textarea
                  rows={2}
                  value={draft.note}
                  maxLength={LANDMARK_NOTE_MAX}
                  onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                  placeholder="Behind the shed, key in the lock box"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-500 dark:text-slate-400">
                  {Number.isFinite(draft.lat) && Number.isFinite(draft.lng)
                    ? `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`
                    : 'Not placed yet'}
                </span>
                <button
                  type="button"
                  onClick={() => setPlacing(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  Choose on map
                </button>
                <button
                  type="button"
                  onClick={useMyPosition}
                  disabled={locating}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
                  Use my position
                </button>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={cancelDraft}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-500 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {saving ? 'Saving…' : 'Save landmark'}
                </button>
              </div>
            </form>
          ) : null}

          {/* A legend of the types that are actually on this station's map, rather than the whole list: colours that mean nothing
              yet are just questions. A pin whose type was removed is COUNTED here rather than quietly folded in, because that is
              a station noticing that its legend changed under it. */}
          {usedTypes.length || orphanCount ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              {usedTypes.map((type) => (
                <span key={type.key} className="inline-flex items-center gap-1.5">
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full"
                    style={{ background: type.color }}
                  >
                    <MapTypeGlyph icon={type.icon} size={10} />
                  </span>
                  {type.label}
                </span>
              ))}
              {orphanCount ? (
                <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {orphanCount} pin{orphanCount === 1 ? '' : 's'} whose type was removed — set them a new one, or add it back
                </span>
              ) : null}
            </div>
          ) : null}

          {landmarks.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-2 border-b border-slate-100 p-4 dark:border-slate-700">
                <MapPin className="h-4 w-4 text-red-500" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Landmarks{' '}
                  <span className="font-normal text-slate-500 dark:text-slate-400">({landmarks.length})</span>
                </h3>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {landmarks.map((pin) => {
                  const type = typeOf(pin);
                  const isSelected = pin.id === selectedId;
                  return (
                    <li key={pin.id}>
                      <button
                        type="button"
                        onClick={() => selectOnMap(pin)}
                        className={`flex w-full items-start gap-3 p-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/40 ${
                          isSelected ? 'bg-slate-50 dark:bg-slate-700/40' : ''
                        }`}
                      >
                        <span
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                          style={{ background: type.color }}
                        >
                          <MapTypeGlyph icon={type.icon} size={12} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">
                            {pin.label}
                          </span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {type.label}
                            {pin.note ? ` · ${pin.note}` : ''}
                          </span>
                        </span>
                      </button>
                      {isSelected && canEdit ? (
                        <div className="flex items-center justify-end gap-2 px-3 pb-3">
                          <button
                            type="button"
                            onClick={() => startEdit(pin)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(pin)}
                            className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {/* In THIS component rather than anywhere else: this is the one holding the pin about to be removed, and a dialog
          rendered from a sibling would not be about anything on screen. */}
      {pendingDelete ? (
        <ConfirmModal
          title="Remove landmark"
          message={
            <>
              Remove <strong className="text-slate-900 dark:text-white">{pendingDelete.label}</strong> from the map? The
              district boundary and the other landmarks are not affected.
            </>
          }
          confirmLabel="Remove"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}




