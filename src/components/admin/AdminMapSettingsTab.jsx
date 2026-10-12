import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Download, Layers, Loader2, Map as MapIcon, MapPin, Palette, Plus, RotateCcw, Save, Search, Trash2, Upload } from 'lucide-react';
import {
  fetchMapLayer,
  adminSaveMapLayer,
  adminDeleteMapLayer,
  fetchMapBoundary,
  adminSaveMapBoundary,
  adminDeleteMapBoundary,
  fetchMapBackdrops,
  adminSaveMapBackdrop,
  adminDeleteMapBackdrop,
  fetchMapLandmarks,
  fetchMapTypes,
  adminSaveMapTypes,
} from '../../services/api';
import {
  cacheMapTypes,
  cachedMapTypes,
} from '../../utils/districtMap';
// WHAT A PIN CAN BE: the station's own list of types, its checks and its built-in starting set - the same functions the map
// screen resolves a pin's kind with, so the card cannot save a list the map would refuse to draw.
import {
  DEFAULT_MAP_TYPES,
  MAP_TYPE_COLOURS,
  MAP_TYPE_LABEL_MAX,
  MAP_TYPE_LIMIT,
  mapTypeKey,
  mapTypesProblem,
  mapTypesView,
} from '../../utils/mapTypes';
// The glyph set the picker offers - the same table the map draws its markers from.
import { MAP_ICON_KEYS } from '../../utils/mapIcons';
import MapTypeGlyph from '../MapTypeGlyph';
// The district boundary's own checks and device copy - the same functions the writer stores with - and the one place that
// talks to the county. See utils/districtMap for why the boundary is real coordinates rather than a drawing.
import {
  MAP_BACKDROP_BAND_METRES,
  MAP_BACKDROP_FIELDS,
  MAP_BACKDROP_LAYERS,
  MAP_BACKDROP_STYLE,
  boundaryProblem,
  cacheBackdrops,
  cacheBoundary,
  geometryPointCount,
} from '../../utils/districtMap';
import {
  COUNTY_FIRE_BEATS_LAYER,
  COUNTY_FIRE_BEATS_SOURCE,
  esriBandFrom,
  esriClipFrom,
  fetchCountyBackdrop,
  fireBeatSearchTerm,
  searchFireBeats,
} from '../../services/countyGis';
// The district map's own refusals, measurements and device copy - the SAME functions the writer stores with, so the file this
// card accepts and the document that is written cannot be two different judgements. The URL hook is shared with the member's
// map screen rather than duplicated there (see utils/mapDrawingUrl for why it is not imported FROM it).
import { cacheMapLayer, clearCachedMapLayer, formatBytes, mapLayerProblem, mapSvgBytes, mapSvgProblem } from '../../utils/mapLayer';
import { useDrawingUrl } from '../../utils/mapDrawingUrl';
// The station's own name, which the fire-beat search starts from rather than making an officer type it: getSettingValue reads a
// system setting out of the payload the panel already holds.
import { getSettingValue } from '../../utils/systemSettings';
import CenteredContent from '../CenteredContent';
import ConfirmModal from '../ConfirmModal';

// THE MAP'S OWN SETTINGS, ON THEIR OWN SCREEN.
//
// These three cards used to sit in the middle of System Settings, between the department name and the clock rounding - which is
// where they were written, and which stopped being the right place once the map grew from a picture of a department to a
// boundary, a background and a set of landmarks. Nothing about them is a system setting: they are the ground the station covers,
// they are read by exactly one screen, and one of them (the boundary) is what the other two are built against.
//
// A card each, in the order they depend on each other:
//
//   * THE BOUNDARY first, because it is the district itself and because the background is CLIPPED TO IT - the background card
//     says so rather than fetching the whole county.
//   * THE BACKGROUND second: the county's roads and waterways, copied once so the map works with no signal. The road names and
//     the beats on either side of a road are part of that copy.
//   * THE DRAWING last, since it is the oldest part of the feature and the only one that is a picture rather than geometry.
//
// The permissions are unchanged by the move, and deliberately so: this screen is reached by the same role that maintained these
// cards when they were a section of System Settings. What changed is where somebody looks for them.
export default function AdminMapSettingsTab({ token, systemSettings, canEditMap = false, canEditSystemSettings = false }) {
  // Capped and centerd, exactly as System Settings is: this is a stack of cards rather than a table, so full width on a wide
  // monitor would leave each card's labels and their controls far apart. See utils/contentWidth.
  return (
    <CenteredContent className="space-y-6">
      {/* EACH CARD FOLLOWS THE PERMISSION ITS SAVE NEEDS, because this screen opens for two of them (utils/permissions#roleAllowsTab).
          A card somebody could not save is not shown greyed out with a save button that refuses: it is replaced by the sentence
          naming the switch that would let them. Nobody is handed a control the server will reject. */}
      {canEditMap ? (
        <>
          <DistrictBoundaryCard token={token} systemSettings={systemSettings} />
          <MapBackgroundCard token={token} />
          {/* THE LEGEND, edited where the rest of the map is set up: what a pin can be is as much a station decision as where
              the district's edge runs. */}
          <MapTypesCard token={token} />
        </>
      ) : (
        <NeedsPermission what="The boundary, and the roads and waterways the map is drawn over">
          Maintain the district map
        </NeedsPermission>
      )}
      {canEditSystemSettings ? (
        <DistrictMapCard token={token} />
      ) : (
        <NeedsPermission what="The department's own drawn map, uploaded as an SVG">
          Manage system settings
        </NeedsPermission>
      )}
    </CenteredContent>
  );
}

// WHAT A CARD SAYS WHEN THE OFFICER CANNOT USE IT. It names the card, and names the permission in the words the Roles screen
// uses - so the answer to "who can do this?" is on the screen rather than in a conversation.
function NeedsPermission({ what, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
      <p className="font-medium text-slate-900 dark:text-white">{what}</p>
      <p className="mt-1">
        Setting this needs the <span className="font-medium">“{children}”</span> permission, which your role does not hold. An
        administrator can grant it in Roles.
      </p>
    </div>
  );
}

// THE DISTRICT MAP: the department's boundary drawing, uploaded here and drawn by the member's District Map module.
//
// IT TOUCHES NO SYSTEM SETTING, deliberately rather than by oversight. The drawing is a document of its own - read when
// the map screen opens rather than on every sign-in, which is the difference between a few hundred kilobytes paid for by
// one screen and the same paid for by every member's payload. utils/mapLayer holds the whole argument, including why the
// drawing is stored as TEXT rather than as an SVG file in the storage bucket.
//
// WHAT THIS CARD OWNS is the part a person does, and each part exists because of a way it can go wrong: reading what is
// stored, checking a chosen file with the SAME function the writer stores with, SHOWING what would be saved before it is,
// and saying honestly whether it was. A refused file is a message about the file rather than a console error.
function DistrictMapCard({ token }) {
  const [layer, setLayer] = useState(null);
  const [loading, setLoading] = useState(true);
  // The chosen drawing's TEXT, held until Save: choosing a file must not upload it, or an officer who picked the wrong
  // export would have already replaced the station's map.
  const [chosen, setChosen] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // The drawing being REMOVED, held in state while the dialog asks - the same shape every other card in this file uses, so
  // the dialog is rendered by the component that holds what it is about to destroy (see scripts/verify-confirmations).
  const [pendingDelete, setPendingDelete] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMapLayer()
      .then((result) => {
        if (cancelled) return;
        setLayer(result && result.mapLayer ? result.mapLayer : null);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'The saved district map could not be read.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // What is previewed: the file just chosen, or what is already stored. One <img>, so the officer sees the drawing the
  // members will see - at the size the card has, which is why the file also reports its own measurements below.
  const previewUrl = useDrawingUrl(chosen ? chosen.svg : layer?.svg || '');
  // A drawing STORED by an older build, or edited by hand, is checked through the same refusals an upload is: this card
  // should not be the place it is discovered.
  const storedProblem = mapLayerProblem(layer);

  const handleFileChange = async (event) => {
    const file = event.target.files && event.target.files[0];
    // Cleared immediately, so choosing the SAME file twice in a row after fixing it still fires a change event.
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    setError(null);
    setSaved(false);
    try {
      // Read as text, never uploaded: the drawing is stored as text, and this is the same text the writer will send.
      const text = await file.text();
      const problem = mapSvgProblem(text);
      if (problem) {
        setChosen(null);
        setError(problem);
        return;
      }
      setChosen({ svg: text, name: file.name });
    } catch (err) {
      setChosen(null);
      setError(err?.message || 'That file could not be read.');
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!chosen) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminSaveMapLayer(chosen.svg, token);
      if (!result || !result.success) {
        throw new Error((result && result.message) || 'Failed to save the district map.');
      }
      // READ BACK rather than trust what was sent: the stored document is the answer to "what is the station's map", so the
      // card shows that - including the date the writer stamped on it - instead of echoing back the file it handed over.
      const fresh = await fetchMapLayer();
      const next = fresh && fresh.mapLayer ? fresh.mapLayer : null;
      setLayer(next);
      // ...and THIS DEVICE is made right at the same moment, because the officer usually opens the map next and the map
      // screen's first paint is the copy on this device (utils/mapLayer).
      if (next) cacheMapLayer(next);
      setChosen(null);
      setSaved(true);
    } catch (err) {
      setError(err?.message || 'Failed to save the district map.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setPendingDelete(null);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminDeleteMapLayer(token);
      if (!result || !result.success) {
        throw new Error((result && result.message) || 'Failed to remove the district map.');
      }
      // The device's copy goes with it, or the next visit to the map would draw the map that was just taken down.
      clearCachedMapLayer();
      setLayer(null);
      setChosen(null);
    } catch (err) {
      setError(err?.message || 'Failed to remove the district map.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <MapIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">District Map</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              The department's boundary drawing, shown in the member's District Map module. Upload an SVG exported from
              whatever you drew it in. Members see it only if their role has {'“'}View the district map{'”'}.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {saved && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-green-50 text-green-600 border border-green-200 dark:bg-green-950/80 dark:text-green-400 dark:border-green-800/80">
            <Check className="w-4 h-4 shrink-0" />
            <span>District map saved!</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading the saved map…</span>
          </div>
        ) : null}

        {storedProblem && !loading ? (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>The saved drawing cannot be drawn: {storedProblem}</span>
          </div>
        ) : null}

        {previewUrl ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
            {/* The preview SAYS WHICH drawing it is. A file that has been chosen but not saved is the state this card exists
                to make obvious: choosing is not uploading, so the two must never look the same. */}
            <p className="mb-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              {chosen ? `Chosen: ${chosen.name} — not saved yet` : 'Currently saved'}
            </p>
            <img src={previewUrl} alt="District map preview" className="mx-auto max-h-72 w-auto max-w-full" />
          </div>
        ) : null}

        {layer && !chosen ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {Number(layer.width) > 0 && Number(layer.height) > 0
              ? `${Math.round(Number(layer.width))} × ${Math.round(Number(layer.height))} drawing units`
              : 'Stored drawing'}
            {layer.updated_at ? ` · saved ${layer.updated_at}` : ''}
            {layer.svg ? ` · ${formatBytes(mapSvgBytes(layer.svg))}` : ''}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              // BOTH the extension and the MIME type, because a browser that has never opened an SVG offers it by type and
              // one that has offers it by extension. What is actually ACCEPTED is decided by reading the text, not by
              // either of these - so a file that arrives here with the wrong name is still judged on its contents.
              accept=".svg,image/svg+xml"
              onChange={handleFileChange}
              className="hidden"
              id="district-map-file"
            />
            <label
              htmlFor="district-map-file"
              className="inline-flex items-center gap-2 cursor-pointer bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium text-sm px-4 py-2.5 rounded-xl transition"
            >
              <Upload className="w-4 h-4" />
              {layer ? 'Replace drawing' : 'Choose SVG'}
            </label>
            {layer ? (
              <button
                type="button"
                onClick={() => setPendingDelete(layer)}
                disabled={saving}
                className="inline-flex items-center gap-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 font-medium text-sm px-3 py-2.5 rounded-xl transition disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                Remove
              </button>
            ) : null}
          </div>

          {/* Disabled until a file has been CHOSEN and accepted: there is nothing to save before that, and a live button
              that does nothing is worse than one that says so. */}
          <button
            type="submit"
            disabled={saving || !chosen}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save Map'}
          </button>
        </div>
      </form>

      {/* In THIS card rather than at the end of the file, and that is not tidiness: a dialog rendered by a component that
          does not hold the drawing would be about something the renderer cannot see - and the row it names is held right
          here, in `pendingDelete`. */}
      {pendingDelete ? (
        <ConfirmModal
          title="Remove district map"
          message={
            <>
              Remove the department's boundary drawing
              {pendingDelete.svg ? ` (${formatBytes(mapSvgBytes(pendingDelete.svg))})` : ''}? The District Map module will
              say that no map has been uploaded until somebody uploads another.
            </>
          }
          confirmLabel="Remove"
          onConfirm={handleRemove}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}


// THE DISTRICT BOUNDARY: the real one, in latitude and longitude - fetched from the county's own open data, or uploaded as a
// GeoJSON file by a department whose county does not publish one.
//
// WHY THIS CARD EXISTS AT ALL, given the department can draw a map: a drawing is a picture of a map, and a boundary is the
// map. The polygon is ~2,245 points and 51 KB for this station's district, it is the county's OFFICIAL line rather than a
// traced copy of it, it can be pinned and measured, and it survives being redrawn. utils/districtMap holds the argument.
//
// IT IS COPIED, NOT LINKED, and that is the whole design: pressing "Find my department" asks the county ONCE and the answer
// is stored in the station's own document. After that the map reads nothing but the station's own data, so it works with no
// signal and does not depend on somebody else's server staying up. Refreshing it is the same button, pressed next year.
function DistrictBoundaryCard({ token, systemSettings }) {
  const [boundary, setBoundary] = useState(null);
  const [loading, setLoading] = useState(true);
  // The county's own name for a department contains words every department shares, so the first one that means something is
  // searched for instead: "Bolivia Volunteer Fire Department" -> "Bolivia". See services/countyGis.js.
  const [search, setSearch] = useState(() => fireBeatSearchTerm(getSettingValue(systemSettings, 'department_name', '')));
  const [matches, setMatches] = useState(null);
  const [checking, setChecking] = useState(false);
  // The boundary being considered: from the county, or from a file. NOT saved until the officer presses Save.
  const [chosen, setChosen] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMapBoundary()
      .then((result) => {
        if (!cancelled) setBoundary(result && result.mapBoundary ? result.mapBoundary : null);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'The saved district boundary could not be read.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const lookUp = async () => {
    setChecking(true);
    setError(null);
    setSaved(false);
    try {
      const answer = await searchFireBeats({ search });
      setMatches(answer.matches);
      if (!answer.matches.length) {
        setError(
          'The county\'s data has no fire beat matching that. Try a different word - a town name usually works - or upload the boundary as a GeoJSON file.'
        );
      }
    } catch (err) {
      setMatches(null);
      setError(err?.message || 'The county\'s map service could not be reached.');
    } finally {
      setChecking(false);
    }
  };

  const chooseBeat = (match) => {
    setError(null);
    setSaved(false);
    setChosen({
      geojson: match.geojson,
      points: geometryPointCount(match.geojson),
      meta: { ...match, source: COUNTY_FIRE_BEATS_SOURCE, source_url: COUNTY_FIRE_BEATS_LAYER },
    });
  };

  // A FILE, for a department whose county does not publish its beats - which is most of them. It is read as TEXT and parsed
  // here rather than uploaded as bytes: what the app stores is the geometry, and it has no interest in the file itself.
  const handleFile = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    setError(null);
    setSaved(false);
    try {
      const text = await file.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('That file is not JSON. Export the boundary as GeoJSON from your GIS system, and upload that file.');
      }
      // The SAME check the writer applies, so a file this card accepts is a file the save will accept.
      const problem = boundaryProblem(parsed);
      if (problem) throw new Error(problem);
      const properties = parsed?.features?.[0]?.properties || parsed?.properties || {};
      const fromFile = String(properties.name || properties.NAME || properties.DisplayName || '').trim();
      setChosen({
        geojson: parsed,
        points: geometryPointCount(parsed),
        meta: { label: fromFile || file.name.replace(/\.[^.]+$/, ''), source: 'Uploaded GeoJSON file' },
      });
    } catch (err) {
      setChosen(null);
      setError(err?.message || 'That file could not be read.');
    }
  };

  const handleSave = async () => {
    if (!chosen) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminSaveMapBoundary({ geojson: chosen.geojson, meta: chosen.meta }, token);
      if (!result || !result.success) throw new Error((result && result.message) || 'Failed to save the district boundary.');
      // READ BACK, so the card says what the map will draw - including the stamp the writer put on the document - and CACHE
      // it for this device, because the officer usually opens the map next.
      const fresh = await fetchMapBoundary().catch(() => null);
      const next = fresh && fresh.mapBoundary ? fresh.mapBoundary : null;
      setBoundary(next);
      cacheBoundary(next);
      setChosen(null);
      setSaved(true);
    } catch (err) {
      setError(err?.message || 'Failed to save the district boundary.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setPendingDelete(null);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminDeleteMapBoundary(token);
      if (!result || !result.success) throw new Error((result && result.message) || 'Failed to remove the district boundary.');
      cacheBoundary(null);
      setBoundary(null);
      setChosen(null);
    } catch (err) {
      setError(err?.message || 'Failed to remove the district boundary.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <MapIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">District boundary</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              The station's district as real coordinates, drawn on the member's District Map with the landmarks pinned on it.
              Fetch it from the county's own data, or upload a GeoJSON file exported out of a GIS system.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {saved && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-green-50 text-green-600 border border-green-200 dark:bg-green-950/80 dark:text-green-400 dark:border-green-800/80">
            <Check className="w-4 h-4 shrink-0" />
            <span>District boundary saved!</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading the saved boundary…</span>
          </div>
        ) : null}

        {boundary ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {boundary.label || 'District boundary'}
              {boundary.zone ? (
                <span className="font-normal text-slate-500 dark:text-slate-400"> · beat {boundary.zone}</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {Number(boundary.points || 0).toLocaleString()} points
              {boundary.agency ? ` · ${boundary.agency}` : ''}
              {boundary.service_num ? ` · ${boundary.service_num}` : ''}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {boundary.source ? `${boundary.source} · ` : ''}
              set {boundary.updated_at || 'unknown'}
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <label
            className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400"
            htmlFor="district-boundary-search"
          >
            Find the station's beat in the county's data
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="district-boundary-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Bolivia"
              className="min-w-[10rem] flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <button
              type="button"
              onClick={lookUp}
              disabled={checking}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
            >
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {checking ? 'Looking…' : 'Look up'}
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Brunswick County publishes every department's fire beat as open data, with the department's own name on it. Looking
            one up here COPIES it into this station's own records - so the map itself never needs the county's server, and works
            with no signal.
          </p>
          {matches && matches.length ? (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {matches.map((match, index) => (
                <li key={`${match.agency}-${index}`}>
                  <button
                    type="button"
                    onClick={() => chooseBeat(match)}
                    className="flex w-full items-start gap-3 p-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/40"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{match.label}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {match.agency}
                        {match.service_num ? ` · ${match.service_num}` : ''}
                        {` · ${geometryPointCount(match.geojson).toLocaleString()} points`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* The boundary being considered. It says so in as many words, because it is NOT saved yet - and saving replaces the
            line every member sees on the map. */}
        {chosen ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="font-medium">{chosen.meta.label || 'Boundary'} — not saved yet</p>
            <p className="mt-0.5 text-xs">
              {chosen.points.toLocaleString()} points
              {chosen.meta.source ? ` · ${chosen.meta.source}` : ''}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              // A `.geojson` file is JSON, and a GIS system may well export it as `.json`. What is ACCEPTED is decided by
              // parsing it and checking it, not by the name.
              accept=".geojson,.json,application/geo+json,application/json"
              onChange={handleFile}
              className="hidden"
              id="district-boundary-file"
            />
            <label
              htmlFor="district-boundary-file"
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
            >
              <Upload className="w-4 h-4" />
              {boundary ? 'Replace from a file' : 'Upload GeoJSON'}
            </label>
            {boundary ? (
              <button
                type="button"
                onClick={() => setPendingDelete(boundary)}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:text-red-600 disabled:opacity-50 dark:text-slate-400 dark:hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
                Remove
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !chosen}
            className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-500 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save boundary'}
          </button>
        </div>
      </div>

      {/* In THIS card, because this is the component holding the boundary being removed. */}
      {pendingDelete ? (
        <ConfirmModal
          title="Remove district boundary"
          message={
            <>
              Remove the district boundary? The map will say that no boundary is set until somebody sets one, and the landmarks
              are not affected.
            </>
          }
          confirmLabel="Remove"
          onConfirm={handleRemove}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}

// THE MAP BACKGROUND: the county's own linework - its roads, its waterways, the FEMA flood zones, the fire districts
// around this one, and the major roads out through them - fetched once and stored as the station's own geometry.
//
// IT IS A COPY FOR THE SAME REASON THE BOUNDARY IS (utils/districtMap argues it in full): a tile layer from somebody else's
// server is the thing this deliberately is not, because the map has to work in a truck with no signal. What is stored is the
// county's own linework, CLIPPED TO THE DISTRICT (and, for the layers that reach past the district line, to a band of ground
// around it - or, for the nearby roads, to the neighbouring districts' own outlines) and GENERALISED BY THE COUNTY - which is
// what turns 1.4 MB of flood zones into 80 KB, and why every layer fits in a document of its own.
//
// THE CLIP COMES FROM THE BOUNDARY, so this card needs one to exist: it says so rather than fetching the whole county.
function MapBackgroundCard({ token }) {
  const [boundary, setBoundary] = useState(null);
  const [backdrops, setBackdrops] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchMapBoundary()
        .then((result) => (result && result.mapBoundary ? result.mapBoundary : null))
        .catch(() => null),
      fetchMapBackdrops()
        .then((result) => (result && result.backdrops && typeof result.backdrops === 'object' ? result.backdrops : {}))
        .catch(() => ({})),
    ])
      .then(([boundaryDoc, backdropDocs]) => {
        if (cancelled) return;
        setBoundary(boundaryDoc);
        setBackdrops(backdropDocs);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const fetchLayer = async (layer) => {
    setBusy(layer);
    setError(null);
    setSaved('');
    try {
      // BOTH CLIPS, because WHICH one a layer is fetched with is the app's decision rather than this card's memory
      // (utils/districtMap#MAP_BACKDROP_CLIP): the district's own outline for the water and the flood zones, and the box
      // around the district plus a band of ground for the roads and the districts next door. A card that had to know which
      // layer wanted which would eventually get it wrong, and the symptom would be a background that stops at the boundary.
      const clip = boundary ? esriClipFrom(boundary.geojson) : null;
      const band = boundary ? esriBandFrom(boundary.geojson, MAP_BACKDROP_BAND_METRES) : null;
      if (!clip || !band) {
        throw new Error('Set the district boundary first - every layer is clipped to it, so the whole county is not fetched.');
      }
      // AND WHO THIS STATION IS, for the one layer that has to leave it out: the county is asked for the beats AROUND this one
      // (services/countyGis#neighbourWhere), and a boundary that arrived as a file has no agency to match - in which case the
      // screen drops the one polygon that lands on its own district.
      const answer = await fetchCountyBackdrop({ layer, clip, band, exclude: boundary.agency });
      const result = await adminSaveMapBackdrop(
        { layer, geojson: answer.collection, meta: { label: MAP_BACKDROP_STYLE[layer].label, source: answer.source, tolerance: answer.tolerance } },
        token
      );
      if (!result || !result.success) throw new Error((result && result.message) || 'Failed to save the map background.');
      // Read back, so the row says what was STORED - including the size and the stamp the writer put on it.
      const fresh = await fetchMapBackdrops().catch(() => null);
      const next = fresh && fresh.backdrops && typeof fresh.backdrops === 'object' ? fresh.backdrops : {};
      setBackdrops(next);
      cacheBackdrops(next);
      setSaved(layer);
    } catch (err) {
      setError(err?.message || 'The map background could not be fetched.');
    } finally {
      setBusy('');
    }
  };

  const removeLayer = async () => {
    const layer = pendingDelete;
    setPendingDelete(null);
    if (!layer) return;
    setBusy(layer);
    setError(null);
    try {
      const result = await adminDeleteMapBackdrop(layer, token);
      if (!result || !result.success) throw new Error((result && result.message) || 'Failed to remove the map background.');
      const next = { ...backdrops };
      delete next[layer];
      setBackdrops(next);
      cacheBackdrops(next);
    } catch (err) {
      setError(err?.message || 'Failed to remove the map background.');
    } finally {
      setBusy('');
    }
  };

  const row = (layer) => {
    const style = MAP_BACKDROP_STYLE[layer];
    const stored = backdrops[layer];
    const size = stored?.geojson ? `${Math.round(String(stored.geojson).length / 1024)} KB` : '';
    // The attributes this layer is SUPPOSED to keep, against the ones it actually has. They differ for exactly one reason: a
    // document fetched before the app started keeping them.
    const wanted = MAP_BACKDROP_FIELDS[layer] || [];
    const kept = Array.isArray(stored?.fields) ? stored.fields : [];
    return (
      <div key={layer} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: style.color }} />
            {style.label}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {stored
              ? `${Number(stored.features || 0).toLocaleString()} features · ${Number(stored.points || 0).toLocaleString()} points · ${size} · set ${stored.updated_at || 'unknown'}`
              : 'Not fetched yet'}
          </p>
          {/* WHAT THE LAYER KEEPS OF ITS OWN ATTRIBUTES, shown only for a layer that is supposed to keep some. A road layer
              with none was fetched before the app started keeping the names and the beats - which is a one-button fix, and
              worth saying out loud rather than leaving somebody to wonder why the roads have no names on them. */}
          {stored && wanted.length ? (
            <p
              className={`mt-0.5 text-xs ${
                kept.length ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {kept.length
                ? `keeping ${kept.join(', ')}`
                : 'stored before the app kept the road names — press Refresh to pull them in'}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {stored ? (
            <button
              type="button"
              onClick={() => setPendingDelete(layer)}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition hover:text-red-600 disabled:opacity-50 dark:text-slate-400 dark:hover:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
              Remove
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => fetchLayer(layer)}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
          >
            {busy === layer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {busy === layer ? 'Fetching…' : stored ? 'Refresh' : 'Fetch'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Map background</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              The county's own linework, drawn under the district boundary: its roads and waterways, the FEMA flood zones, and
              the fire districts around this one. Each layer is fetched once and kept on the station's own records — clipped to
              the district and simplified on the way out — so the map draws them with no network and no dependency on anybody
              else's server.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {saved && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-green-50 text-green-600 border border-green-200 dark:bg-green-950/80 dark:text-green-400 dark:border-green-800/80">
            <Check className="w-4 h-4 shrink-0" />
            <span>{MAP_BACKDROP_STYLE[saved]?.label} saved — it is on the map for everybody who can see the map.</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading the saved background…</span>
          </div>
        ) : null}

        {!loading && !boundary ? (
          <div className="p-3 rounded-xl text-sm bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/40">
            The district boundary has not been set, so there is nothing to clip the background to. Set it above first: the county
            publishes these layers for the whole county, and only the ground around this district is wanted.
          </div>
        ) : null}

        {!loading && boundary ? MAP_BACKDROP_LAYERS.map(row) : null}

        <p className="text-xs text-slate-500 dark:text-slate-400">
          The geometry's own attributes — road names, which fire beat each side of a road belongs to, the FEMA zone a polygon
          is in — are not stored beyond what a layer draws: a background is drawn rather than looked up. The roads and the
          districts around this one reach a kilometre past the boundary, so the map can show the far side of a road and whose
          ground is next door. A fetch takes a few seconds on a good connection.
        </p>
      </div>

      {pendingDelete ? (
        <ConfirmModal
          title="Remove map background"
          message={
            <>
              Remove {MAP_BACKDROP_STYLE[pendingDelete]?.label.toLowerCase()} from the map? The boundary and the landmarks are not
              affected.
            </>
          }
          confirmLabel="Remove"
          onConfirm={removeLayer}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}

// THE LANDMARK TYPES: what a pin on this station's map can be - a name, an icon and a color each.
//
// THIS IS THE LEGEND, which is why it is a card rather than a corner of the map screen: a district's dots are read by everybody
// at once, so what they mean is a station-wide decision. The card edits the WHOLE list and saves it in one write, because a type
// added while another is being renamed has to arrive as one list (utils/mapTypes).
//
// IT ALSO COUNTS WHAT IS USING EACH TYPE. That is one extra read of the pins, which this card otherwise does not need - and it
// is worth it, because removing a type in use is the one mistake here that stays invisible until somebody is looking at a grey
// dot: the count is on the row before the button is pressed.
function MapTypesCard({ token }) {
  const [types, setTypes] = useState(() => {
    const cached = cachedMapTypes();
    return Array.isArray(cached) && cached.length ? mapTypesView({ types: cached }) : DEFAULT_MAP_TYPES;
  });
  const [usage, setUsage] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  // Which row has its icons open, and which has its colours open. One at a time: two open pickers on a phone is a card nobody
  // can read.
  const [openIcons, setOpenIcons] = useState('');
  const [openColours, setOpenColours] = useState('');

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      setLoading(true);
      // Each read answers for itself: the types are what this card is FOR, and the pins are only a count - so a station whose
      // pins cannot be read still gets an editable list rather than an error.
      const [typeAnswer, pinAnswer] = await Promise.all([
        fetchMapTypes().catch(() => null),
        fetchMapLandmarks().catch(() => null),
      ]);
      if (cancelled) return;
      setTypes(mapTypesView(typeAnswer?.mapTypes ?? null));
      cacheMapTypes(typeAnswer?.mapTypes ?? null);
      const counts = {};
      (pinAnswer?.mapLandmarks || []).forEach((pin) => {
        const key = String(pin?.kind || '');
        // A pin counts under the key it still carries, so a type somebody removed and added back shows its pins again.
        if (key) counts[key] = (counts[key] || 0) + 1;
      });
      setUsage(counts);
      setLoading(false);
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, []);

  // EDITING IS LOCAL UNTIL SAVE, like every other card here: an officer who opens the card, changes their mind and leaves has
  // changed nothing for anybody else.
  const editRow = (index, patch) => {
    setSaved(false);
    setError('');
    setTypes((current) => current.map((type, at) => (at === index ? { ...type, ...patch } : type)));
  };

  const addRow = () => {
    setSaved(false);
    setError('');
    setTypes((current) => [...current, { key: mapTypeKey('New type', current), label: 'New type', icon: 'map-pin', color: MAP_TYPE_COLOURS[0] }]);
  };

  const removeRow = (index) => {
    setSaved(false);
    setError('');
    setTypes((current) => current.filter((_, at) => at !== index));
  };

  const save = async () => {
    const problem = mapTypesProblem(types);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await adminSaveMapTypes({ types }, token);
      if (!result || !result.success) throw new Error((result && result.message) || 'Failed to save the landmark types.');
      const next = Array.isArray(result.types) ? result.types : types;
      setTypes(next);
      // The device's copy, so the MAP picks the new colours up next time it opens without a signal - the same promise the pins
      // and the boundary keep.
      cacheMapTypes({ types: next });
      setSaved(true);
    } catch (err) {
      setError(err?.message || 'Failed to save the landmark types.');
    } finally {
      setSaving(false);
    }
  };


  const resetToBuiltIn = () => {
    setSaved(false);
    setError('');
    setTypes(DEFAULT_MAP_TYPES);
  };

  const problem = mapTypesProblem(types);
  const full = types.length >= MAP_TYPE_LIMIT;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-start gap-3">
        <Palette className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Landmark types</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            What a pin on the district map can be: a name, an icon and a color each. Members choose from this list when they add
            a landmark, and it is the map&apos;s legend — so rename freely, and add the things this district actually has.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-600 dark:border-red-800/80 dark:bg-red-950/80 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading the types…
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-2">
            {types.map((type, index) => (
              <div key={`${type.key}-${index}`} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  {/* The type's own disc is also the button that opens the icon picker: the thing being chosen is the button
                      that chooses it, so the row shows what the map will show. */}
                  <button
                    type="button"
                    title="Choose an icon"
                    onClick={() => {
                      setOpenIcons((current) => (current === type.key ? '' : type.key));
                      setOpenColours('');
                    }}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-2 ring-white transition hover:scale-105 dark:ring-slate-800"
                    style={{ background: type.color }}
                  >
                    <MapTypeGlyph icon={type.icon} size={18} />
                  </button>
                  <input
                    value={type.label}
                    maxLength={MAP_TYPE_LABEL_MAX}
                    aria-label="Type name"
                    onChange={(event) => editRow(index, { label: event.target.value })}
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {usage[type.key] ? `${usage[type.key]} pin${usage[type.key] === 1 ? '' : 's'}` : 'unused'}
                  </span>
                  <button
                    type="button"
                    title="Choose a color"
                    onClick={() => {
                      setOpenColours((current) => (current === type.key ? '' : type.key));
                      setOpenIcons('');
                    }}
                    className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Color
                  </button>
                  <button
                    type="button"
                    title={types.length <= 1 ? 'A map needs at least one type' : 'Remove this type'}
                    disabled={types.length <= 1}
                    onClick={() => removeRow(index)}
                    className="rounded-xl px-2 py-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {openIcons === type.key ? (
                  <div className="mt-3 grid grid-cols-8 gap-1.5 rounded-xl bg-slate-50 p-2 sm:grid-cols-10 dark:bg-slate-900/60">
                    {MAP_ICON_KEYS.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        title={icon}
                        aria-pressed={icon === type.icon}
                        onClick={() => editRow(index, { icon })}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                          icon === type.icon
                            ? 'bg-white text-slate-900 ring-1 ring-slate-300 dark:bg-slate-700 dark:text-white dark:ring-slate-500'
                            : 'text-slate-500 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700'
                        }`}
                      >
                        {/* `currentColor` so one grid shows forty glyphs in the page's own ink rather than forty colours. */}
                        <MapTypeGlyph icon={icon} size={16} color="currentColor" />
                      </button>
                    ))}
                  </div>
                ) : null}

                {openColours === type.key ? (
                  <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl bg-slate-50 p-2 dark:bg-slate-900/60">
                    {MAP_TYPE_COLOURS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        title={color}
                        aria-pressed={color === type.color}
                        onClick={() => {
                          editRow(index, { color });
                          setOpenColours('');
                        }}
                        className={`h-7 w-7 rounded-full transition hover:scale-110 ${
                          color === type.color ? 'ring-2 ring-slate-400 ring-offset-1 dark:ring-offset-slate-800' : ''
                        }`}
                        style={{ background: color }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addRow}
              disabled={full}
              title={full ? `A legend holds ${MAP_TYPE_LIMIT} types` : 'Add a type'}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <Plus className="h-4 w-4" />
              Add a type
            </button>
            <button
              type="button"
              onClick={resetToBuiltIn}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              <RotateCcw className="h-4 w-4" />
              Start again from the built-in eight
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || Boolean(problem)}
              title={problem || 'Save the list'}
              className="ml-auto inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save types'}
            </button>
          </div>

          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {problem
              ? problem
              : saved
                ? 'Saved — the map’s pins are drawn from this list.'
                : `${types.length} of ${MAP_TYPE_LIMIT} types. Renaming a type does not change the pins already wearing it.`}
          </p>
        </>
      )}
    </section>
  );
}

