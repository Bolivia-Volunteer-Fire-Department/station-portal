import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../DistrictMap.css';
import {
  AlertCircle,
  Building2,
  Check,
  Compass,
  Crosshair,
  ExternalLink,
  Eye,
  Filter,
  Info,
  Layers,
  Loader2,
  LocateFixed,
  MapPin,
  Maximize2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  BUILDING_FLOORS,
  BUILDING_LANDMARK_CATEGORIES,
  BUILDING_LANDMARK_TYPES,
  BUILDING_SIDES,
  buildingLandmarkMarkerHtml,
  buildingLandmarkTypeFor,
  normalizeBuildingLandmark,
} from '../../utils/buildingLandmarks.js';
import MapTypeGlyph from '../MapTypeGlyph.jsx';
import { roundCoordinate } from '../../utils/districtMap.js';
import {
  createUserLocationIcon,
  watchUserCoordinates,
  clearUserCoordinatesWatch,
} from '../../utils/geolocation.js';

// Tile provider options for high-resolution building site imagery
const TILE_PROVIDERS = {
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, USDA',
  },
  streets: {
    name: 'Streets / Topo',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: '&copy; OpenStreetMap contributors',
  },
};

// Quick-add shortcut types shown in top toolbar for 1-click fire tactical placement
const QUICK_ADD_TYPES = [
  'side_a',
  'fdc',
  'riser_room',
  'facp',
  'electrical_shutoff',
  'gas_shutoff',
  'knox_box',
  'roof_access',
];

export default function PreplanBuildingMap({
  plan = {},
  editable = false,
  onChangeLandmarks,
  onChangeCoordinates,
  className = '',
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const buildingMarkerRef = useRef(null);
  const userLocationMarkerRef = useRef(null);
  const watchIdRef = useRef(null);

  const [mapType, setMapType] = useState('satellite');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeLandmarkId, setActiveLandmarkId] = useState(null);

  // Live user location tracking state
  const [isTrackingUser, setIsTrackingUser] = useState(false);
  const [isLocatingUser, setIsLocatingUser] = useState(false);
  const [userLocationError, setUserLocationError] = useState('');

  // Placement mode state
  const [placingType, setPlacingType] = useState(null); // type key when placing pin
  const [editingLandmark, setEditingLandmark] = useState(null); // landmark object open in edit sheet
  const [isPickerModalOpen, setIsPickerModalOpen] = useState(false);

  const landmarks = useMemo(
    () => (Array.isArray(plan.building_landmarks) ? plan.building_landmarks : []),
    [plan.building_landmarks]
  );

  const hasCoords = Number.isFinite(plan.latitude) && Number.isFinite(plan.longitude);
  const centerLat = hasCoords ? plan.latitude : 34.0521;
  const centerLng = hasCoords ? plan.longitude : -78.1492;

  // Filtered landmarks for directory list
  const filteredLandmarks = useMemo(() => {
    return landmarks.filter((lm) => {
      const typeDef = buildingLandmarkTypeFor(lm.type);
      if (selectedCategory !== 'all' && typeDef.category !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesLabel = (lm.label || '').toLowerCase().includes(q);
        const matchesType = (typeDef.label || '').toLowerCase().includes(q);
        const matchesSide = (lm.side || '').toLowerCase().includes(q);
        const matchesFloor = (lm.floor || '').toLowerCase().includes(q);
        const matchesNotes = (lm.notes || '').toLowerCase().includes(q);
        return matchesLabel || matchesType || matchesSide || matchesFloor || matchesNotes;
      }
      return true;
    });
  }, [landmarks, selectedCategory, searchQuery]);

  // ---- Initialize Leaflet Map ----
  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        center: [centerLat, centerLng],
        zoom: hasCoords ? 19 : 17,
        minZoom: 14,
        maxZoom: 22,
        zoomSnap: 0.5,
        zoomDelta: 0.5,
        attributionControl: true,
      });

      map.attributionControl.setPrefix('');
      mapRef.current = map;

      // Base Tile Layer
      const cfg = TILE_PROVIDERS[mapType] || TILE_PROVIDERS.satellite;
      const tiles = L.tileLayer(cfg.url, {
        maxNativeZoom: cfg.maxNativeZoom,
        maxZoom: cfg.maxZoom,
        attribution: cfg.attribution,
      }).addTo(map);
      tileLayerRef.current = tiles;

      // Layers group for landmarks
      markersLayerRef.current = L.layerGroup().addTo(map);

      // Invalidate size on next tick to prevent grey tiles
      setTimeout(() => {
        map.invalidateSize();
      }, 150);
    }

    return () => {
      if (watchIdRef.current !== null) {
        clearUserCoordinatesWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (userLocationMarkerRef.current) {
        userLocationMarkerRef.current.remove();
        userLocationMarkerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        tileLayerRef.current = null;
        markersLayerRef.current = null;
        buildingMarkerRef.current = null;
      }
    };
  }, []);

  // Update Tile Layer when mapType switches
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }
    const cfg = TILE_PROVIDERS[mapType] || TILE_PROVIDERS.satellite;
    tileLayerRef.current = L.tileLayer(cfg.url, {
      maxNativeZoom: cfg.maxNativeZoom,
      maxZoom: cfg.maxZoom,
      attribution: cfg.attribution,
    }).addTo(map);
  }, [mapType]);

  // Recenter when plan coordinates change externally
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasCoords) return;
    map.setView([plan.latitude, plan.longitude], map.getZoom() || 19, { animate: true });
  }, [plan.latitude, plan.longitude, hasCoords]);

  // ---- Building Center Marker ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (buildingMarkerRef.current) {
      buildingMarkerRef.current.remove();
      buildingMarkerRef.current = null;
    }

    if (hasCoords) {
      const icon = L.divIcon({
        className: 'building-center-icon',
        html: `
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            background: #2563eb;
            color: #ffffff;
            border-radius: 9999px;
            border: 3px solid #ffffff;
            box-shadow: 0 4px 10px rgba(0,0,0,0.45);
          ">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>
              <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/>
              <path d="M10 12h4"/><path d="M10 8h4"/>
            </svg>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const marker = L.marker([plan.latitude, plan.longitude], {
        icon,
        draggable: Boolean(editable && onChangeCoordinates),
        zIndexOffset: 100,
      }).addTo(map);

      marker.bindPopup(`
        <div style="font-family: system-ui, sans-serif; font-size: 12px; line-height: 1.4; padding: 4px;">
          <div style="font-weight: 700; color: #0f172a; margin-bottom: 2px;">${plan.occupancy_name || 'Building Center'}</div>
          <div style="color: #64748b; font-size: 11px;">Primary Preplan Location</div>
          <div style="color: #0f172a; font-family: monospace; font-size: 10px; margin-top: 4px;">
            ${plan.latitude.toFixed(6)}, ${plan.longitude.toFixed(6)}
          </div>
        </div>
      `);

      if (editable && onChangeCoordinates) {
        marker.on('dragend', (e) => {
          const pos = e.target.getLatLng();
          onChangeCoordinates({
            latitude: roundCoordinate(pos.lat),
            longitude: roundCoordinate(pos.lng),
          });
        });
      }

      buildingMarkerRef.current = marker;
    }
  }, [hasCoords, plan.latitude, plan.longitude, plan.occupancy_name, editable, onChangeCoordinates]);

  // ---- Render Building Landmarks on Map ----
  useEffect(() => {
    const group = markersLayerRef.current;
    if (!group) return;

    group.clearLayers();

    landmarks.forEach((lm) => {
      if (!Number.isFinite(lm.latitude) || !Number.isFinite(lm.longitude)) return;

      const isSelected = activeLandmarkId === lm.id;
      const typeDef = buildingLandmarkTypeFor(lm.type);

      const icon = L.divIcon({
        className: 'building-landmark-div-icon',
        html: buildingLandmarkMarkerHtml(lm, { isSelected }),
        iconSize: [60, 36],
        iconAnchor: [30, 34],
      });

      const marker = L.marker([lm.latitude, lm.longitude], {
        icon,
        draggable: Boolean(editable),
        zIndexOffset: isSelected ? 500 : 200,
      }).addTo(group);

      // Popup Content
      const popupHtml = `
        <div style="font-family: system-ui, sans-serif; min-width: 170px; max-width: 260px; font-size: 12px; line-height: 1.4; padding: 2px;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
            <span style="background: ${typeDef.color}; color: #ffffff; padding: 2px 6px; border-radius: 9999px; font-size: 10px; font-weight: 700;">
              ${typeDef.shortLabel}
            </span>
            <span style="font-weight: 700; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${lm.label || typeDef.label}
            </span>
          </div>
          <div style="color: #475569; font-size: 11px; margin-bottom: 2px;">
            <strong>Side:</strong> ${lm.side || 'Unspecified'} &middot; <strong>Floor:</strong> ${lm.floor || 'Exterior'}
          </div>
          ${lm.notes ? `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 6px; margin: 4px 0; color: #1e293b; font-size: 11px; font-style: italic;">${lm.notes}</div>` : ''}
          <div style="color: #94a3b8; font-family: monospace; font-size: 9px; margin-top: 4px;">
            GPS: ${Number(lm.latitude).toFixed(6)}, ${Number(lm.longitude).toFixed(6)}
          </div>
        </div>
      `;
      marker.bindPopup(popupHtml);

      // Drag update
      if (editable) {
        marker.on('dragend', (e) => {
          const pos = e.target.getLatLng();
          const nextLat = roundCoordinate(pos.lat);
          const nextLng = roundCoordinate(pos.lng);
          const updated = landmarks.map((item) =>
            item.id === lm.id ? { ...item, latitude: nextLat, longitude: nextLng } : item
          );
          onChangeLandmarks?.(updated);
        });
      }

      // Click behavior
      marker.on('click', () => {
        setActiveLandmarkId(lm.id);
        if (editable) {
          setEditingLandmark(lm);
        }
      });
    });
  }, [landmarks, activeLandmarkId, editable, onChangeLandmarks]);

  // ---- Map Click Handler for Placing New Landmarks ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !editable) return;

    const handleMapClick = (e) => {
      if (placingType) {
        const lat = roundCoordinate(e.latlng.lat);
        const lng = roundCoordinate(e.latlng.lng);
        const typeDef = buildingLandmarkTypeFor(placingType);

        const newLm = normalizeBuildingLandmark({
          type: placingType,
          label: `${typeDef.label}`,
          latitude: lat,
          longitude: lng,
          side: 'Side A (Alpha - Front)',
          floor: 'Exterior',
          notes: '',
        });

        const nextList = [...landmarks, newLm];
        onChangeLandmarks?.(nextList);
        setPlacingType(null);
        setEditingLandmark(newLm);
        setActiveLandmarkId(newLm.id);
      } else if (!hasCoords && onChangeCoordinates) {
        // If no coords exist, clicking map sets building anchor
        const lat = roundCoordinate(e.latlng.lat);
        const lng = roundCoordinate(e.latlng.lng);
        onChangeCoordinates({ latitude: lat, longitude: lng });
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [placingType, editable, landmarks, hasCoords, onChangeLandmarks, onChangeCoordinates]);

  // Cursor update when placing mode is active
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (placingType) {
      container.style.cursor = 'crosshair';
    } else {
      container.style.cursor = '';
    }
  }, [placingType]);

  // Pan to landmark
  const handlePanToLandmark = useCallback((lm) => {
    const map = mapRef.current;
    if (!map || !Number.isFinite(lm.latitude) || !Number.isFinite(lm.longitude)) return;
    setActiveLandmarkId(lm.id);
    map.setView([lm.latitude, lm.longitude], Math.max(map.getZoom() || 19, 19.5), {
      animate: true,
    });
  }, []);

  // Save changes from Edit Landmark sheet
  const handleSaveLandmarkEdit = (updatedLm) => {
    const nextList = landmarks.map((item) => (item.id === updatedLm.id ? updatedLm : item));
    onChangeLandmarks?.(nextList);
    setEditingLandmark(null);
  };

  // Delete a landmark
  const handleDeleteLandmark = (landmarkId) => {
    const nextList = landmarks.filter((item) => item.id !== landmarkId);
    onChangeLandmarks?.(nextList);
    if (editingLandmark?.id === landmarkId) {
      setEditingLandmark(null);
    }
    if (activeLandmarkId === landmarkId) {
      setActiveLandmarkId(null);
    }
  };

  // Live user location tracking handlers
  const stopUserTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      clearUserCoordinatesWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (userLocationMarkerRef.current) {
      userLocationMarkerRef.current.remove();
      userLocationMarkerRef.current = null;
    }
    setIsTrackingUser(false);
    setIsLocatingUser(false);
  }, []);

  const startUserTracking = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    stopUserTracking();
    setIsLocatingUser(true);
    setUserLocationError('');

    let hasCentered = false;

    const id = watchUserCoordinates(
      (coords) => {
        setIsLocatingUser(false);
        setIsTrackingUser(true);

        const currentMap = mapRef.current;
        if (!currentMap) return;

        if (!userLocationMarkerRef.current) {
          const icon = createUserLocationIcon(L);
          const marker = L.marker([coords.latitude, coords.longitude], {
            icon,
            zIndexOffset: 1000,
          }).addTo(currentMap);

          marker.bindPopup(`
            <div style="font-family: system-ui, sans-serif; font-size: 12px; line-height: 1.4; padding: 2px;">
              <div style="font-weight: 700; color: #1e40af;">Your Current Position</div>
              <div style="color: #64748b; font-size: 11px;">Live GPS Tracking</div>
              <div style="color: #0f172a; font-family: monospace; font-size: 10px; margin-top: 3px;">
                ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}
              </div>
            </div>
          `);
          userLocationMarkerRef.current = marker;
        } else {
          userLocationMarkerRef.current.setLatLng([coords.latitude, coords.longitude]);
        }

        if (!hasCentered) {
          hasCentered = true;
          currentMap.setView([coords.latitude, coords.longitude], Math.max(currentMap.getZoom() || 19, 19), {
            animate: true,
          });
        }
      },
      (err) => {
        setIsLocatingUser(false);
        setIsTrackingUser(false);
        setUserLocationError(err?.errorMessage || 'Location unavailable.');
        if (userLocationMarkerRef.current) {
          userLocationMarkerRef.current.remove();
          userLocationMarkerRef.current = null;
        }
      }
    );
    watchIdRef.current = id;
  }, [stopUserTracking]);

  const toggleUserLocationTracking = useCallback(() => {
    if (isTrackingUser || isLocatingUser) {
      stopUserTracking();
    } else {
      startUserTracking();
    }
  }, [isTrackingUser, isLocatingUser, stopUserTracking, startUserTracking]);

  // Recenter on building
  const handleRecenter = () => {
    const map = mapRef.current;
    if (!map || !hasCoords) return;
    map.setView([plan.latitude, plan.longitude], 19, { animate: true });
    setActiveLandmarkId(null);
  };

  return (
    <div className={`flex flex-col space-y-4 ${className}`}>
      {/* User Location Error Notice */}
      {userLocationError ? (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>{userLocationError}</span>
          </div>
          <button
            type="button"
            onClick={() => setUserLocationError('')}
            className="text-amber-700 hover:text-amber-900 dark:text-amber-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* Placement Mode Active Banner */}
      {placingType ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-400 bg-blue-50 px-4 py-2.5 text-xs text-blue-900 shadow-sm dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-200 animate-pulse">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span>
              <strong>Click on the satellite imagery</strong> to position{' '}
              <strong className="underline">{buildingLandmarkTypeFor(placingType).label}</strong> on the building.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPlacingType(null)}
            className="inline-flex items-center gap-1 rounded-xl bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
      ) : null}

      {/* Top Map Toolbar: Satellite/Street Toggle & Quick Tactical Placement */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          {/* Layer switcher */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-2xs dark:border-slate-700 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setMapType('satellite')}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                mapType === 'satellite'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
              }`}
            >
              🛰️ Satellite View
            </button>
            <button
              type="button"
              onClick={() => setMapType('streets')}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                mapType === 'streets'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
              }`}
            >
              🗺️ Streets
            </button>
          </div>

          {hasCoords ? (
            <button
              type="button"
              onClick={handleRecenter}
              title="Recenter on building"
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <RotateCcw className="h-3 w-3 text-slate-500" />
              Center Building
            </button>
          ) : null}

          {/* Locate User Button */}
          <button
            type="button"
            onClick={toggleUserLocationTracking}
            title={isTrackingUser ? 'Stop locating / tracking your position' : 'Locate and track your position on the tactical map'}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-semibold shadow-2xs transition ${
              isTrackingUser
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/70 dark:text-blue-300'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {isLocatingUser ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
            ) : (
              <LocateFixed
                className={`h-3.5 w-3.5 ${
                  isTrackingUser ? 'animate-pulse text-blue-600 dark:text-blue-400' : 'text-slate-500'
                }`}
              />
            )}
            <span>{isTrackingUser ? 'Tracking Me' : isLocatingUser ? 'Locating…' : 'Locate Me'}</span>
          </button>
        </div>

        {/* Quick Add Toolbar for Fire Tactical Features (in Edit mode) */}
        {editable ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Quick Plot:
            </span>
            {QUICK_ADD_TYPES.map((typeKey) => {
              const def = buildingLandmarkTypeFor(typeKey);
              const isActive = placingType === typeKey;
              return (
                <button
                  key={typeKey}
                  type="button"
                  onClick={() => setPlacingType(isActive ? null : typeKey)}
                  className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-semibold transition shadow-2xs ${
                    isActive
                      ? 'ring-2 ring-blue-500 ring-offset-1 text-white'
                      : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 dark:hover:bg-slate-700'
                  }`}
                  style={isActive ? { background: def.color } : {}}
                  title={def.description}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white shadow-2xs"
                    style={{ background: def.color }}
                  >
                    <MapTypeGlyph icon={def.icon} letter={def.letter} size={10} color="#ffffff" />
                  </span>
                  <span>+{def.shortLabel}</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setIsPickerModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white shadow-2xs transition hover:bg-blue-500"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>More...</span>
            </button>
          </div>
        ) : null}
      </div>

      {/* Satellite Map Container */}
      <div className="relative h-[440px] w-full overflow-hidden rounded-2xl border border-slate-200 shadow-inner dark:border-slate-700">
        <div ref={containerRef} className="h-full w-full" />

        {/* Missing GPS Warning Overlay */}
        {!hasCoords ? (
          <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center bg-slate-900/60 p-6 text-center text-white backdrop-blur-xs">
            <Building2 className="h-10 w-10 text-blue-400 mb-2 animate-bounce" />
            <h4 className="text-base font-bold">Building GPS Location Not Set</h4>
            <p className="mt-1 max-w-md text-xs text-slate-300">
              Enter GPS coordinates in Tab 1 (Occupancy & Location), or click anywhere on this satellite view to establish the building center location.
            </p>
          </div>
        ) : null}

        {/* In-Map Tactical Legend / Counter Badge */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-[400] flex items-center gap-2 rounded-xl bg-slate-900/80 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur-xs shadow-md">
          <MapPin className="h-3.5 w-3.5 text-blue-400" />
          <span>
            {landmarks.length} tactical landmark{landmarks.length === 1 ? '' : 's'} plotted
          </span>
        </div>
      </div>

      {/* Directory & Landmark Detail Section */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-700 dark:bg-slate-800/80">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-700">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
              Tactical Building Landmarks & Shutoffs ({landmarks.length})
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              FDCs, sprinkler risers, utility shutoffs, Knox boxes, and roof access points for this structure.
            </p>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search landmarks..."
              className="w-48 rounded-xl border border-slate-200 bg-slate-50 py-1 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {BUILDING_LANDMARK_CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            const count =
              cat.id === 'all'
                ? landmarks.length
                : landmarks.filter((lm) => buildingLandmarkTypeFor(lm.type).category === cat.id).length;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-semibold transition ${
                  isSelected
                    ? 'bg-slate-900 text-white dark:bg-blue-600'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                <span>{cat.label}</span>
                <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10px] dark:bg-white/20">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Landmarks Grid / List */}
        {filteredLandmarks.length > 0 ? (
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredLandmarks.map((lm) => {
              const def = buildingLandmarkTypeFor(lm.type);
              const isSelected = activeLandmarkId === lm.id;

              return (
                <div
                  key={lm.id}
                  onClick={() => handlePanToLandmark(lm)}
                  className={`group relative flex cursor-pointer flex-col justify-between rounded-xl border p-3 transition shadow-2xs ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/20 dark:border-blue-500 dark:bg-blue-950/40 dark:hover:bg-blue-950/60'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white shadow-2xs"
                          style={{ background: def.color }}
                        >
                          <MapTypeGlyph icon={def.icon} letter={def.letter} size={13} color="#ffffff" />
                        </span>
                        <div>
                          <div className="font-semibold text-xs text-slate-900 dark:text-white truncate" title={lm.label || def.label}>
                            {lm.label || def.label}
                          </div>
                          <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            {lm.side} &middot; {lm.floor}
                          </div>
                        </div>
                      </div>

                      {editable ? (
                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingLandmark(lm);
                            }}
                            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                            title="Edit Landmark"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteLandmark(lm.id);
                            }}
                            className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                            title="Delete Landmark"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {lm.notes ? (
                      <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 p-1.5 rounded-lg border border-slate-100 dark:bg-slate-900/40 dark:border-slate-800 line-clamp-2">
                        {lm.notes}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 border-t border-slate-100 pt-1.5 dark:border-slate-700/60">
                    <span className="font-mono">
                      {Number(lm.latitude).toFixed(5)}, {Number(lm.longitude).toFixed(5)}
                    </span>
                    <span className="text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-0.5">
                      View on map &rarr;
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
            {searchQuery || selectedCategory !== 'all'
              ? 'No building landmarks match your filters.'
              : 'No building landmarks plotted yet. Click any quick-plot button above to mark FDCs, shutoffs, or Knox boxes directly on the satellite view.'}
          </div>
        )}
      </div>

      {/* Landmark Placement Modal / Full Landmark Type Picker */}
      {isPickerModalOpen ? (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                  <MapPin className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Choose Building Feature to Plot
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Select a feature type to place on the satellite map
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPickerModalOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {BUILDING_LANDMARK_TYPES.map((typeDef) => (
                <button
                  key={typeDef.key}
                  type="button"
                  onClick={() => {
                    setPlacingType(typeDef.key);
                    setIsPickerModalOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-left transition hover:border-blue-400 hover:bg-blue-50/30 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-blue-500 dark:hover:bg-blue-950/30"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white shadow-xs"
                      style={{ background: typeDef.color }}
                    >
                      <MapTypeGlyph icon={typeDef.icon} letter={typeDef.letter} size={16} color="#ffffff" />
                    </span>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        {typeDef.label}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {typeDef.description}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    Select &rarr;
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Edit Landmark Modal / Form */}
      {editingLandmark ? (
        <EditLandmarkDialog
          landmark={editingLandmark}
          onSave={handleSaveLandmarkEdit}
          onDelete={() => handleDeleteLandmark(editingLandmark.id)}
          onClose={() => setEditingLandmark(null)}
        />
      ) : null}
    </div>
  );
}

// Sub-component dialog for editing an existing or newly placed landmark
function EditLandmarkDialog({ landmark, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState({ ...landmark });

  const currentType = buildingLandmarkTypeFor(draft.type);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-xl text-white shadow-2xs"
              style={{ background: currentType.color }}
            >
              <MapTypeGlyph icon={currentType.icon} letter={currentType.letter} size={15} color="#ffffff" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Edit Building Landmark
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {currentType.label}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3.5">
          {/* Type Select */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Landmark Type
            </span>
            <select
              value={draft.type}
              onChange={(e) => {
                const nextType = e.target.value;
                const def = buildingLandmarkTypeFor(nextType);
                setDraft((cur) => ({
                  ...cur,
                  type: nextType,
                  label: cur.label === currentType.label ? def.label : cur.label,
                }));
              }}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              {BUILDING_LANDMARK_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label} ({t.shortLabel})
                </option>
              ))}
            </select>
          </label>

          {/* Label */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Label / Description *
            </span>
            <input
              type="text"
              required
              value={draft.label}
              onChange={(e) => setDraft((cur) => ({ ...cur, label: e.target.value }))}
              placeholder="e.g. Main FDC - Side A"
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>

          {/* Building Side & Floor Grid */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Building Side
              </span>
              <select
                value={draft.side}
                onChange={(e) => setDraft((cur) => ({ ...cur, side: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                {BUILDING_SIDES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Floor Level
              </span>
              <select
                value={draft.floor}
                onChange={(e) => setDraft((cur) => ({ ...cur, floor: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                {BUILDING_FLOORS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Tactical Notes */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Operational Notes & Key Specs
            </span>
            <textarea
              rows={3}
              value={draft.notes}
              onChange={(e) => setDraft((cur) => ({ ...cur, notes: e.target.value }))}
              placeholder="e.g. 5-inch Storz adapter required, 150 PSI. Key inside Knox box #401."
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>

          {/* GPS Info */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            <span>Coordinates (drag on map to move):</span>
            <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
              {Number(draft.latitude).toFixed(6)}, {Number(draft.longitude).toFixed(6)}
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-500"
            >
              <Check className="h-3.5 w-3.5" />
              Save Landmark
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

