import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
// Leaflet's own stylesheet, imported HERE rather than in index.css so it travels in this screen's chunk: a member who
// never opens the map never downloads it. Vite extracts it into the lazy chunk automatically.
import 'leaflet/dist/leaflet.css';
import './DistrictMap.css';
import { AlertCircle, Loader2, Map as MapIcon, Maximize } from 'lucide-react';
import { fetchMapLayer } from '../services/api';
import { cacheMapLayer, cachedMapLayer, mapLayerBounds, mapLayerIsEmpty, mapLayerProblem } from '../utils/mapLayer';
import { useDrawingUrl } from '../utils/mapDrawingUrl';

// THE DRAWING SHEET: the department's uploaded boundary drawing, panned and zoomed, as one of the two views the District Map
// module offers.
//
// It is the OLDER of the two views, and the smaller half of the module: a sheet has no coordinates in it, so it can only be
// looked at - it cannot be pinned, measured, or laid beside a neighbouring district. The real map (components/DistrictMap)
// is what the module opens on, and this is what a station that has drawn one can flip to. See utils/mapLayer for why the
// drawing is stored as text rather than as a file in the bucket, and utils/districtMap for what replaced it.
//
// WHAT THE MAP IS, AND IS NOT. There is no earth underneath it. Leaflet is put into `CRS.Simple`, a plain x/y plane, and
// the drawing is laid across it with `imageOverlay` - so one unit of the drawing is one unit of the map, and there are no
// tiles, no keys and no third-party service in this view at all.
//
// THE DRAWING ARRIVES AS TEXT and is drawn through a BLOB URL in an `<img>`: storage.rules refuses SVG FILES on purpose (an
// SVG can carry script), and this never gives one the chance to be markup - an image is an image, whatever is inside it.
export default function DistrictMapDrawing({ token }) {
  // THE DEVICE'S COPY IS THE FIRST PAINT rather than a fallback: a member standing in a truck with no signal should see
  // the map immediately rather than a spinner that resolves into nothing.
  const [layer, setLayer] = useState(() => cachedMapLayer());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // NO `setLoading(true)` HERE, deliberately, and it is not an optimisation: the state starts true, and on a NEW SESSION
    // the drawing from the last one is still the station's boundary - so showing it while the re-read lands beats replacing
    // it with a spinner. The spinner is for the first read, which is exactly what the initial `true` covers.
    fetchMapLayer()
      .then((result) => {
        if (cancelled) return;
        const next = result && result.mapLayer ? result.mapLayer : null;
        // ONLY A REAL CHANGE REPLACES THE LAYER. This object's identity is what tears the Leaflet view down below, so
        // handing back a freshly built copy of the same drawing would rebuild the map for nothing - a flicker at the
        // moment the read lands, which is exactly when the member is looking at it.
        setLayer((current) => (current && next && current.svg === next.svg ? current : next));
        setError('');
        cacheMapLayer(next);
      })
      .catch((err) => {
        // The map stays: last time's copy is still the station's own boundary, and the note says which of the two is on
        // screen rather than leaving the member to guess.
        if (!cancelled) setError(err?.message || 'The district map could not be read.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const empty = mapLayerIsEmpty(layer);
  // A drawing stored by an older build, or edited by hand, is checked through the same refusals an upload is: the map
  // screen should not be the place a bad file is discovered.
  const problem = mapLayerProblem(layer);
  const drawable = !empty && !problem;
  const bounds = useMemo(() => (drawable ? mapLayerBounds(layer) : null), [drawable, layer]);
  const drawingUrl = useDrawingUrl(drawable ? layer.svg : '');

  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!drawingUrl || !bounds || !containerRef.current) return undefined;

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      // A drawing is not a place, so the bounds are the only thing keeping the view sane: without them the view drifts
      // into empty space with no clear way back.
      maxBoundsViscosity: 0.75,
      // Half steps, because a district drawing is a handful of thousandths of the ground and whole steps are coarse.
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      // Our own line rather than Leaflet's default prefix, which links to a website about a project the member has never
      // heard of. The credit stays: Leaflet is doing the drawing.
      attributionControl: true,
    });
    mapRef.current = map;
    map.attributionControl.setPrefix('');
    map.attributionControl.addAttribution('Drawn by the department');

    L.imageOverlay(drawingUrl, bounds).addTo(map);

    // FIT FIRST, THEN SET THE LIMITS AROUND THE FIT. Reading the fitted zoom before choosing the range is what makes the
    // limits right for a drawing of ANY size: one exported at 20,000 units and one exported at 800 both open looking the
    // same, and neither can be zoomed down to a speck or up to a single street with no way back.
    map.fitBounds(bounds);
    const fitZoom = map.getZoom();
    map.setMinZoom(fitZoom - 3);
    map.setMaxZoom(fitZoom + 5);
    const pad = Math.max(bounds[1][0], bounds[1][1]) * 0.05;
    map.setMaxBounds([
      [-pad, -pad],
      [bounds[1][0] + pad, bounds[1][1] + pad],
    ]);

    // StrictMode runs an effect twice, so this teardown has to be COMPLETE rather than tidy: `remove()` is Leaflet's own
    // and it detaches the panes, the handlers and the container's Leaflet id, which is what makes a second create against
    // the same <div> work at all.
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [drawingUrl, bounds]);

  const resetView = () => {
    const map = mapRef.current;
    if (map && bounds) map.fitBounds(bounds);
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {error}
            {drawable ? ' The map below is the copy saved on this device.' : ''}
          </p>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading the district map…</span>
        </div>
      ) : null}

      {/* ONLY WHEN THE READ SUCCEEDED. A read that failed and found nothing cached says so in the banner above; adding "no
          district map yet" underneath it would tell the member a fact nobody has established. */}
      {empty && !loading && !error ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-700 dark:bg-slate-800">
          <MapIcon className="mx-auto h-10 w-10 text-slate-400" />
          <h3 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">No district map yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
            An administrator can upload an SVG of the department's district map from Administration → Content → Map Setup. Once it is
            saved it appears here for everybody whose role may see it.
          </p>
        </div>
      ) : null}

      {problem && !empty ? (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">The saved drawing cannot be drawn.</p>
              <p className="mt-1">{problem}</p>
            </div>
          </div>
        </div>
      ) : null}

      {drawable ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-xl dark:border-slate-700">
          {/* `relative z-0 isolate` is not decoration: Leaflet's panes carry raw z-indexes in the hundreds, which would
              otherwise sit ON TOP of the app's own header and sidebar. The stacking context keeps the map inside its card. */}
          <div
            ref={containerRef}
            className={`station-district-map relative z-0 isolate h-[60vh] min-h-[320px] w-full bg-slate-100 transition-colors duration-200 dark:bg-slate-900 ${
              isDark ? 'station-map-dark' : ''
            }`}
          />
        </div>
      ) : null}

      {drawable ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500 dark:text-slate-400">
          <p>
            Drag to move, pinch or scroll to zoom, double-click to zoom in.
            {layer?.updated_at ? ` Last uploaded ${layer.updated_at}.` : ''}
          </p>
          {/* A WAY BACK, because panning a drawing with nothing around it is how you lose it - and the buttons Leaflet
              draws for itself are zoom only. */}
          <button
            type="button"
            onClick={resetView}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <Maximize className="h-4 w-4" />
            Reset view
          </button>
        </div>
      ) : null}
    </div>
  );
}


