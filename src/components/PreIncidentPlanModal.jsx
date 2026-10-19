import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Calendar,
  Camera,
  Check,
  ClipboardCheck,
  Compass,
  Crosshair,
  Droplets,
  Eye,
  FileText,
  FileUp,
  Flame,
  Loader2,
  LocateFixed,
  MapPin,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  BUILDING_CONSTRUCTION_TYPES,
  HYDRANT_STATUSES,
  HYDRANT_TYPES,
  INSPECTION_STATUSES,
  OCCUPANCY_TYPES,
  PROPERTY_USES,
  ROOF_CONSTRUCTIONS,
  ROOF_MATERIALS,
  ROOF_TYPES,
  US_STATES,
  calculateDistanceFeet,
  formatDistance,
  getPreplanInspectionDue,
  normalizePreIncidentPlan,
  normalizePreplanNote,
  normalizeSiteInspection,
  preIncidentPlanProblem,
} from '../utils/preIncidentPlans';
import { getCurrentCoordinates } from '../utils/geolocation';
import { discardPreplanFile, openPreplanFile, uploadPreplanFile } from '../services/preplanFileStorage';
import { formatFileSize } from '../utils/apparatus';
import CameraCaptureModal from './CameraCaptureModal';
import ConfirmModal from './ConfirmModal';
import PreIncidentPlanView from './PreIncidentPlanView';
import PreplanBuildingMap from './preplans/PreplanBuildingMap';
import PrintablePreIncidentPlan from './PrintablePreIncidentPlan';
import { useAuth } from '../context/AuthContext';

export default function PreIncidentPlanModal({
  plan,
  isOpen,
  onClose,
  onSave,
  onDelete,
  canEdit = false,
  initialEdit = false,
  onRequestMapPick,
  stationName = '',
  onNavigateToMap,
  existingHydrants = [],
}) {
  const [isEditing, setIsEditing] = useState(initialEdit);
  const [activeTab, setActiveTab] = useState('occupancy');
  const [draft, setDraft] = useState(() => normalizePreIncidentPlan(plan || {}, stationName));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Existing hydrants selection & auto-distance
  const [showHydrantPicker, setShowHydrantPicker] = useState(false);
  const [hydrantSearch, setHydrantSearch] = useState('');

  // File uploads & camera capture
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileUploadError, setFileUploadError] = useState('');
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [viewTab, setViewTab] = useState('details'); // 'details' | 'map'
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const { currentUser } = useAuth();
  const currentUserId = String(currentUser?.id || currentUser?.uid || '');

  // Subform inputs for edit tabs 9 and 10
  const [newInspection, setNewInspection] = useState({
    inspection_date: new Date().toISOString().split('T')[0],
    inspector_name: '',
    status: 'passed',
    notes: '',
  });
  const [newNoteInput, setNewNoteInput] = useState('');

  const bodyRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setDraft(normalizePreIncidentPlan(plan || {}, stationName));
      setIsEditing(initialEdit || !plan?.id);
      setActiveTab('occupancy');
      setViewTab('details');
      setError('');
      setShowHydrantPicker(false);
      setHydrantSearch('');
      setUploadingFile(false);
      setUploadProgress(0);
      setFileUploadError('');
      setNewInspection({
        inspection_date: new Date().toISOString().split('T')[0],
        inspector_name: currentUser?.name || currentUser?.displayName || '',
        status: 'passed',
        notes: '',
      });
      setNewNoteInput('');
    }
  }, [isOpen, plan, initialEdit, stationName, currentUser]);

  const handleAddInspection = () => {
    if (!newInspection.inspection_date) return;
    const item = normalizeSiteInspection({
      ...newInspection,
      inspector_name: newInspection.inspector_name.trim() || currentUser?.name || 'Inspector',
      inspector_id: currentUserId,
      created_by: currentUser?.name || '',
    });
    setDraft((cur) => ({
      ...cur,
      site_inspections: [item, ...(cur.site_inspections || [])],
    }));
    setNewInspection({
      inspection_date: new Date().toISOString().split('T')[0],
      inspector_name: currentUser?.name || currentUser?.displayName || '',
      status: 'passed',
      notes: '',
    });
  };

  const handleRemoveInspection = (index) => {
    setDraft((cur) => {
      const next = [...(cur.site_inspections || [])];
      next.splice(index, 1);
      return { ...cur, site_inspections: next };
    });
  };

  const handleAddNote = () => {
    if (!newNoteInput.trim()) return;
    const note = normalizePreplanNote({
      content: newNoteInput.trim(),
      author_id: currentUserId,
      author_name: currentUser?.name || currentUser?.displayName || 'Crew Member',
    });
    setDraft((cur) => ({
      ...cur,
      notes: [note, ...(cur.notes || [])],
    }));
    setNewNoteInput('');
  };

  const handleRemoveNote = (index) => {
    setDraft((cur) => {
      const next = [...(cur.notes || [])];
      next.splice(index, 1);
      return { ...cur, notes: next };
    });
  };

  const handlePrint = () => {
    setPrinting(true);
  };

  const updateField = (field, value) => {
    setDraft((cur) => ({ ...cur, [field]: value }));
  };

  const useMyPosition = async () => {
    setLocating(true);
    setError('');
    try {
      const at = await getCurrentCoordinates();
      if (Number.isFinite(at?.latitude) && Number.isFinite(at?.longitude)) {
        setDraft((cur) => ({ ...cur, latitude: at.latitude, longitude: at.longitude }));
      } else {
        setError('Device position unavailable. Please choose coordinates on the map or type them.');
      }
    } catch {
      setError('Failed to fetch device position.');
    } finally {
      setLocating(false);
    }
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    const prob = preIncidentPlanProblem(draft);
    if (prob) {
      setError(prob);
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave(draft);
      setIsEditing(false);
    } catch (err) {
      setError(err?.message || 'Failed to save pre-incident plan.');
    } finally {
      setSaving(false);
    }
  };

  // Contacts helpers
  const addContact = () => {
    setDraft((cur) => ({
      ...cur,
      contacts: [
        ...(cur.contacts || []),
        { id: Math.random().toString(36).substring(2, 9), name: '', address: '', phone: '', description: '' },
      ],
    }));
  };

  const updateContact = (index, field, value) => {
    setDraft((cur) => {
      const next = [...(cur.contacts || [])];
      next[index] = { ...next[index], [field]: value };
      return { ...cur, contacts: next };
    });
  };

  const removeContact = (index) => {
    setDraft((cur) => {
      const next = [...(cur.contacts || [])];
      next.splice(index, 1);
      return { ...cur, contacts: next };
    });
  };

  // Hydrants helpers
  const addHydrant = () => {
    setDraft((cur) => ({
      ...cur,
      nearby_hydrants: [
        ...(cur.nearby_hydrants || []),
        {
          id: '',
          hydrant_id: '',
          address: '',
          distance: '',
          flow: null,
          status: 'in-service',
          type: 'dry',
          latitude: null,
          longitude: null,
          notes: '',
        },
      ],
    }));
  };

  const updateHydrant = (index, field, value) => {
    setDraft((cur) => {
      const next = [...(cur.nearby_hydrants || [])];
      const updated = { ...next[index], [field]: value };

      if (field === 'latitude' || field === 'longitude') {
        const rawLat = field === 'latitude' ? (value !== '' ? Number(value) : null) : updated.latitude;
        const rawLon = field === 'longitude' ? (value !== '' ? Number(value) : null) : updated.longitude;
        if (
          Number.isFinite(cur.latitude) &&
          Number.isFinite(cur.longitude) &&
          Number.isFinite(rawLat) &&
          Number.isFinite(rawLon)
        ) {
          const distFeet = calculateDistanceFeet(cur.latitude, cur.longitude, rawLat, rawLon);
          if (distFeet !== null) {
            updated.distance = formatDistance(distFeet);
          }
        }
      }

      next[index] = updated;
      return { ...cur, nearby_hydrants: next };
    });
  };

  const recalculateHydrantDistance = (index) => {
    const h = (draft.nearby_hydrants || [])[index];
    if (!h) return;
    if (
      Number.isFinite(draft.latitude) &&
      Number.isFinite(draft.longitude) &&
      Number.isFinite(h.latitude) &&
      Number.isFinite(h.longitude)
    ) {
      const distFeet = calculateDistanceFeet(draft.latitude, draft.longitude, h.latitude, h.longitude);
      if (distFeet !== null) {
        updateHydrant(index, 'distance', formatDistance(distFeet));
      }
    }
  };

  const removeHydrant = (index) => {
    setDraft((cur) => {
      const next = [...(cur.nearby_hydrants || [])];
      next.splice(index, 1);
      return { ...cur, nearby_hydrants: next };
    });
  };

  const selectExistingHydrant = (hydrant) => {
    const hLat = Number.isFinite(hydrant.latitude) ? hydrant.latitude : null;
    const hLon = Number.isFinite(hydrant.longitude) ? hydrant.longitude : null;
    let computedDistance = hydrant.distance || '';
    if (
      Number.isFinite(draft.latitude) &&
      Number.isFinite(draft.longitude) &&
      Number.isFinite(hLat) &&
      Number.isFinite(hLon)
    ) {
      const distFeet = calculateDistanceFeet(draft.latitude, draft.longitude, hLat, hLon);
      if (distFeet !== null) {
        computedDistance = formatDistance(distFeet);
      }
    }

    setDraft((cur) => {
      const existing = cur.nearby_hydrants || [];
      const tagOrId = hydrant.hydrant_id || hydrant.id;
      if (tagOrId && existing.some((h) => (h.hydrant_id || h.id) === tagOrId)) {
        return cur;
      }
      return {
        ...cur,
        nearby_hydrants: [
          ...existing,
          {
            id: hydrant.id || hydrant.hydrant_id || '',
            hydrant_id: hydrant.hydrant_id || hydrant.id || '',
            address: hydrant.address || '',
            distance: computedDistance,
            flow: hydrant.flow ?? null,
            status: hydrant.status || 'in-service',
            type: hydrant.type || 'dry',
            latitude: hLat,
            longitude: hLon,
            notes: hydrant.notes || '',
          },
        ],
      };
    });
    setShowHydrantPicker(false);
  };

  const attachedHydrantIds = useMemo(() => {
    return new Set(
      (draft.nearby_hydrants || [])
        .map((h) => (h.hydrant_id || h.id || '').trim().toLowerCase())
        .filter(Boolean)
    );
  }, [draft.nearby_hydrants]);

  const availableExistingHydrants = useMemo(() => {
    return (existingHydrants || [])
      .map((h) => {
        let distFt = null;
        if (
          Number.isFinite(draft.latitude) &&
          Number.isFinite(draft.longitude) &&
          Number.isFinite(h.latitude) &&
          Number.isFinite(h.longitude)
        ) {
          distFt = calculateDistanceFeet(draft.latitude, draft.longitude, h.latitude, h.longitude);
        }
        return { ...h, calculatedDistanceFeet: distFt };
      })
      .filter((h) => {
        const q = hydrantSearch.trim().toLowerCase();
        if (!q) return true;
        return (
          (h.id && h.id.toLowerCase().includes(q)) ||
          (h.address && h.address.toLowerCase().includes(q)) ||
          (h.notes && h.notes.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (a.calculatedDistanceFeet !== null && b.calculatedDistanceFeet !== null) {
          return a.calculatedDistanceFeet - b.calculatedDistanceFeet;
        }
        if (a.calculatedDistanceFeet !== null) return -1;
        if (b.calculatedDistanceFeet !== null) return 1;
        return (a.id || '').localeCompare(b.id || '');
      });
  }, [existingHydrants, draft.latitude, draft.longitude, hydrantSearch]);

  // File Upload Helpers
  const uploadSingleFile = async (file) => {
    if (!file) return;
    setUploadingFile(true);
    setFileUploadError('');
    setUploadProgress(0);
    try {
      const planId = draft.id || draft._tempId || (draft.occupancy_id ? draft.occupancy_id : `temp_${Date.now()}`);
      if (!draft._tempId && !draft.id) {
        setDraft((cur) => ({ ...cur, _tempId: planId }));
      }
      const uploaded = await uploadPreplanFile({
        planId,
        file,
        onProgress: (p) => setUploadProgress(Math.round(p * 100)),
      });
      setDraft((cur) => ({
        ...cur,
        files: [...(cur.files || []), uploaded],
      }));
      return uploaded;
    } catch (err) {
      setFileUploadError(err?.message || 'Failed to upload document or diagram.');
      throw err;
    } finally {
      setUploadingFile(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await uploadSingleFile(file);
      } catch {
        // error reported to state in uploadSingleFile
      }
    }
  };

  const handleCameraCapture = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await uploadSingleFile(file);
      } catch {
        // error reported to state in uploadSingleFile
      }
    }
  };

  const handleRemoveFile = async (index) => {
    const fileToRemove = (draft.files || [])[index];
    if (fileToRemove?.storagePath) {
      void discardPreplanFile(fileToRemove.storagePath);
    }
    setDraft((cur) => {
      const next = [...(cur.files || [])];
      next.splice(index, 1);
      return { ...cur, files: next };
    });
  };

  const editTabs = [
    { id: 'occupancy', label: '1. Occupancy & Location', icon: Building2 },
    { id: 'prefire', label: '2. Prefire & Building', icon: Flame },
    { id: 'fireprotection', label: '3. Water & Systems', icon: Droplets },
    { id: 'hydrants', label: `4. Nearby Hydrants (${draft.nearby_hydrants?.length || 0})`, icon: Droplets },
    { id: 'chemicals', label: '5. HazMat & Chemicals', icon: ShieldAlert },
    { id: 'contacts', label: `6. Emergency Contacts (${draft.contacts?.length || 0})`, icon: Users },
    { id: 'files', label: `7. Diagrams & Files (${draft.files?.length || 0})`, icon: Paperclip },
    { id: 'site_map', label: `8. Building Map (${draft.building_landmarks?.length || 0})`, icon: MapPin },
    { id: 'inspections', label: `9. Site Inspections (${draft.site_inspections?.length || 0})`, icon: ClipboardCheck },
    { id: 'notes', label: `10. Notes Log (${draft.notes?.length || 0})`, icon: MessageSquare },
  ];

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
        <div className="relative flex h-[88vh] max-h-[92vh] w-full max-w-4xl flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                <Building2 className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {isEditing
                    ? draft.id
                    ? 'Edit Pre-Incident Plan'
                    : 'New Pre-Incident Plan'
                    : draft.occupancy_name || 'Pre-Incident Plan'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isEditing ? 'Configure prefire response data, building specs, and hazards' : `Occupancy ID: ${draft.occupancy_id}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!isEditing && canEdit ? (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit Plan
                </button>
              ) : null}

              {!isEditing ? (
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
              ) : null}

              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* View Mode Tabs Bar (when reading preplan) */}
          {!isEditing ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-6 py-2.5 backdrop-blur-xs dark:border-slate-800 dark:bg-slate-800/50">
              <button
                type="button"
                onClick={() => setViewTab('details')}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  viewTab === 'details'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-700/60'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                Pre-Incident Plan Overview
              </button>
              <button
                type="button"
                onClick={() => setViewTab('map')}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  viewTab === 'map'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-700/60'
                }`}
              >
                <MapPin className="h-3.5 w-3.5" />
                Building Satellite Map ({draft.building_landmarks?.length || 0})
              </button>
            </div>
          ) : null}

          {/* Form Tabs Bar (pinned below header) */}
          {isEditing ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50/80 px-6 py-2.5 backdrop-blur-xs dark:border-slate-800 dark:bg-slate-800/50">
              {editTabs.map((tab) => {
                const Icon = tab.icon;
                const on = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.id);
                      bodyRef.current?.scrollTo({ top: 0, behavior: 'instant' });
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                      on
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-700/60'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Body */}
          <div ref={bodyRef} className="flex-1 overflow-y-auto px-6 py-5">
            {error ? (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 p-3.5 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                <p>{error}</p>
              </div>
            ) : null}

            {isEditing ? (
              <form id="preplan-form" onSubmit={handleSave} className="space-y-6">

                {/* TAB 1: Occupancy Information */}
                {activeTab === 'occupancy' ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Occupancy Name *
                        </span>
                        <input
                          type="text"
                          required
                          value={draft.occupancy_name}
                          onChange={(e) => updateField('occupancy_name', e.target.value)}
                          placeholder="e.g. Oakridge Mall / Acme Industrial"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Occupancy ID (Auto-generated if blank)
                        </span>
                        <input
                          type="text"
                          value={draft.occupancy_id}
                          onChange={(e) => updateField('occupancy_id', e.target.value)}
                          placeholder="Auto-generated (e.g. OCC-2026-XXXX)"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    {/* Address Fields */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Street Address 1
                        </span>
                        <input
                          type="text"
                          value={draft.address1}
                          onChange={(e) => updateField('address1', e.target.value)}
                          placeholder="123 Main St"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Street Address 2
                        </span>
                        <input
                          type="text"
                          value={draft.address2}
                          onChange={(e) => updateField('address2', e.target.value)}
                          placeholder="Suite / Unit / Building B"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          City
                        </span>
                        <input
                          type="text"
                          value={draft.city}
                          onChange={(e) => updateField('city', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          State
                        </span>
                        <select
                          value={draft.state}
                          onChange={(e) => updateField('state', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">Select...</option>
                          {US_STATES.map((st) => (
                            <option key={st} value={st}>{st}</option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          ZIP Code
                        </span>
                        <input
                          type="text"
                          value={draft.zip_code}
                          onChange={(e) => updateField('zip_code', e.target.value)}
                          placeholder="e.g. 28422"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    {/* Coordinates & Picker */}
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        Map Location (Coordinates) *
                      </span>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Latitude</span>
                          <input
                            type="number"
                            step="any"
                            value={draft.latitude ?? ''}
                            onChange={(e) => updateField('latitude', e.target.value ? Number(e.target.value) : null)}
                            placeholder="e.g. 34.05214"
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Longitude</span>
                          <input
                            type="number"
                            step="any"
                            value={draft.longitude ?? ''}
                            onChange={(e) => updateField('longitude', e.target.value ? Number(e.target.value) : null)}
                            placeholder="e.g. -78.14925"
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                          />
                        </label>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {onRequestMapPick ? (
                          <button
                            type="button"
                            onClick={() => {
                              onRequestMapPick(draft);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            <Crosshair className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                            Choose on map
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={useMyPosition}
                          disabled={locating}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5 text-emerald-600" />}
                          Use my position
                        </button>
                      </div>
                    </div>

                    {/* Occupancy Type & Property Use */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Occupancy Type
                        </span>
                        <select
                          value={draft.occupancy_type}
                          onChange={(e) => updateField('occupancy_type', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">Select Occupancy Type...</option>
                          {OCCUPANCY_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Property Use
                        </span>
                        <select
                          value={draft.property_use}
                          onChange={(e) => updateField('property_use', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">Select Property Use...</option>
                          {PROPERTY_USES.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {/* Phone / Email / Fax */}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Primary Phone
                        </span>
                        <input
                          type="text"
                          value={draft.primary_phone}
                          onChange={(e) => updateField('primary_phone', e.target.value)}
                          placeholder="e.g. 910-555-0199"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Primary Email
                        </span>
                        <input
                          type="email"
                          value={draft.primary_email}
                          onChange={(e) => updateField('primary_email', e.target.value)}
                          placeholder="contact@occupancy.com"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Primary Fax
                        </span>
                        <input
                          type="text"
                          value={draft.primary_fax}
                          onChange={(e) => updateField('primary_fax', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    {/* Administrative & Technical Identifiers */}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          ISO ID
                        </span>
                        <input
                          type="text"
                          value={draft.iso_id}
                          onChange={(e) => updateField('iso_id', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Utility Billing Number
                        </span>
                        <input
                          type="text"
                          value={draft.utility_billing_number}
                          onChange={(e) => updateField('utility_billing_number', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          National Grid
                        </span>
                        <input
                          type="text"
                          value={draft.national_grid}
                          onChange={(e) => updateField('national_grid', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Business License No.
                        </span>
                        <input
                          type="text"
                          value={draft.business_license_number}
                          onChange={(e) => updateField('business_license_number', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Assessor Parcel No. (APN)
                        </span>
                        <input
                          type="text"
                          value={draft.assessor_parcel_number}
                          onChange={(e) => updateField('assessor_parcel_number', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Assessed Value ($)
                        </span>
                        <input
                          type="number"
                          value={draft.assessed_value ?? ''}
                          onChange={(e) => updateField('assessed_value', e.target.value ? Number(e.target.value) : null)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-4">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Year Built
                        </span>
                        <input
                          type="number"
                          value={draft.year_built ?? ''}
                          onChange={(e) => updateField('year_built', e.target.value ? Number(e.target.value) : null)}
                          placeholder="e.g. 1998"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Assigned Inspector
                        </span>
                        <input
                          type="text"
                          value={draft.assigned_inspector}
                          onChange={(e) => updateField('assigned_inspector', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Occupancy Zone
                        </span>
                        <input
                          type="text"
                          value={draft.occupancy_zone}
                          onChange={(e) => updateField('occupancy_zone', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Station
                        </span>
                        <input
                          type="text"
                          value={draft.station}
                          onChange={(e) => updateField('station', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Critical Infrastructure
                      </span>
                      <input
                        type="text"
                        value={draft.critical_infrastructure}
                        onChange={(e) => updateField('critical_infrastructure', e.target.value)}
                        placeholder="e.g. Substation, Water Treatment, Communications Hub, Hospital"
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>
                  </div>
                ) : null}

                {/* TAB 2: Prefire Plan & Building */}
                {activeTab === 'prefire' ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Building Height (ft)
                        </span>
                        <input
                          type="number"
                          value={draft.building_height ?? ''}
                          onChange={(e) => updateField('building_height', e.target.value ? Number(e.target.value) : null)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Building Width (ft)
                        </span>
                        <input
                          type="number"
                          value={draft.building_width ?? ''}
                          onChange={(e) => updateField('building_width', e.target.value ? Number(e.target.value) : null)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Building Length (ft)
                        </span>
                        <input
                          type="number"
                          value={draft.building_length ?? ''}
                          onChange={(e) => updateField('building_length', e.target.value ? Number(e.target.value) : null)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-4">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          No. of Floors
                        </span>
                        <input
                          type="number"
                          value={draft.floors ?? ''}
                          onChange={(e) => updateField('floors', e.target.value ? Number(e.target.value) : null)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Square Footage
                        </span>
                        <input
                          type="number"
                          value={draft.square_footage ?? ''}
                          onChange={(e) => updateField('square_footage', e.target.value ? Number(e.target.value) : null)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Needed Fire Flow (gpm)
                        </span>
                        <input
                          type="number"
                          value={draft.needed_fire_flow ?? ''}
                          onChange={(e) => updateField('needed_fire_flow', e.target.value ? Number(e.target.value) : null)}
                          placeholder="e.g. 1500"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <div className="block pt-1">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Basement Present?
                        </span>
                        <label className="mt-2 inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.basement_present}
                            onChange={(e) => updateField('basement_present', e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700"
                          />
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Basement Present
                          </span>
                        </label>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Building Construction Type
                        </span>
                        <select
                          value={draft.building_construction_type}
                          onChange={(e) => updateField('building_construction_type', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">Select Construction Type...</option>
                          {BUILDING_CONSTRUCTION_TYPES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Hours of Occupancy
                        </span>
                        <input
                          type="text"
                          value={draft.hours_of_occupancy}
                          onChange={(e) => updateField('hours_of_occupancy', e.target.value)}
                          placeholder="e.g. Mon-Fri 0800-1700, 24/7, Closed weekends"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    {/* Roof Info */}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Roof Type
                        </span>
                        <select
                          value={draft.roof_type}
                          onChange={(e) => updateField('roof_type', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">Select Roof Type...</option>
                          {ROOF_TYPES.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Roof Material
                        </span>
                        <select
                          value={draft.roof_material}
                          onChange={(e) => updateField('roof_material', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">Select Roof Material...</option>
                          {ROOF_MATERIALS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Roof Construction
                        </span>
                        <select
                          value={draft.roof_construction}
                          onChange={(e) => updateField('roof_construction', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">Select Roof Construction...</option>
                          {ROOF_CONSTRUCTIONS.map((rc) => (
                            <option key={rc} value={rc}>{rc}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {/* Key locations & shutoffs */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Master Key Location (Knox Box)
                        </span>
                        <input
                          type="text"
                          value={draft.master_key_location}
                          onChange={(e) => updateField('master_key_location', e.target.value)}
                          placeholder="e.g. Front entrance, right of main doors"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Fire Alarm Panel Location (FACP)
                        </span>
                        <input
                          type="text"
                          value={draft.fire_alarm_panel_location}
                          onChange={(e) => updateField('fire_alarm_panel_location', e.target.value)}
                          placeholder="e.g. Front vestibule, electrical room 101"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Electrical Panel Location
                        </span>
                        <input
                          type="text"
                          value={draft.electrical_panel_location}
                          onChange={(e) => updateField('electrical_panel_location', e.target.value)}
                          placeholder="e.g. North mechanical room, exterior disconnect"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Gas / LPG Shutoff Location
                        </span>
                        <input
                          type="text"
                          value={draft.gas_lpg_shutoff_location}
                          onChange={(e) => updateField('gas_lpg_shutoff_location', e.target.value)}
                          placeholder="e.g. West exterior wall behind enclosure"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Building Access
                        </span>
                        <input
                          type="text"
                          value={draft.building_access}
                          onChange={(e) => updateField('building_access', e.target.value)}
                          placeholder="e.g. Paved drive all 4 sides, secure gate code #1234"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Access Problems
                        </span>
                        <input
                          type="text"
                          value={draft.access_problems}
                          onChange={(e) => updateField('access_problems', e.target.value)}
                          placeholder="e.g. Narrow alley on East side, low wires on South"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Ventilation Problems
                        </span>
                        <input
                          type="text"
                          value={draft.ventilation_problems}
                          onChange={(e) => updateField('ventilation_problems', e.target.value)}
                          placeholder="e.g. Skylights covered, dead air space, dropped ceilings"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          Exposure Information
                        </span>
                        <input
                          type="text"
                          value={draft.exposure_info}
                          onChange={(e) => updateField('exposure_info', e.target.value)}
                          placeholder="e.g. Bravo side 15ft to frame warehouse; Delta side parking"
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Other Location Information
                      </span>
                      <input
                        type="text"
                        value={draft.other_location_info}
                        onChange={(e) => updateField('other_location_info', e.target.value)}
                        placeholder="Additional tactical spatial context"
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Prefire Plan Notes (Tactical & Strategic Overview)
                      </span>
                      <textarea
                        rows={3}
                        value={draft.prefire_plan_notes}
                        onChange={(e) => updateField('prefire_plan_notes', e.target.value)}
                        placeholder="Operational guidance for incoming incident commanders and crews..."
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>
                  </div>
                ) : null}

                {/* TAB 3: Fire Protection Systems */}
                {activeTab === 'fireprotection' ? (
                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Fire Department Connection (FDC) Locations
                      </span>
                      <input
                        type="text"
                        value={draft.fdc_locations}
                        onChange={(e) => updateField('fdc_locations', e.target.value)}
                        placeholder="e.g. Side Alpha right of main entrance, 4-inch Storz"
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Sprinkler Room Location & System Specs
                      </span>
                      <input
                        type="text"
                        value={draft.sprinkler_room_location}
                        onChange={(e) => updateField('sprinkler_room_location', e.target.value)}
                        placeholder="e.g. Riser room located on North-West exterior corner, keyed entrance"
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Water Supply Information
                      </span>
                      <textarea
                        rows={3}
                        value={draft.water_supply_info}
                        onChange={(e) => updateField('water_supply_info', e.target.value)}
                        placeholder="e.g. 12-inch municipal main on Main St, static 65 psi, residual 48 psi. Rural draft pond 800ft East."
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>
                  </div>
                ) : null}

                {/* TAB 4: Nearby Hydrants */}
                {activeTab === 'hydrants' ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Record hydrants surrounding this occupancy, with GPS coordinates, distance, and flow ratings.
                      </p>
                      <div className="flex items-center gap-2">
                        {existingHydrants && existingHydrants.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setShowHydrantPicker((v) => !v)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-xs transition hover:bg-blue-50 dark:border-blue-900/50 dark:bg-slate-800 dark:text-blue-300 dark:hover:bg-slate-700"
                          >
                            <Compass className="h-3.5 w-3.5" />
                            {showHydrantPicker ? 'Hide Hydrant Picker' : `Select Existing Hydrant (${existingHydrants.length})`}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={addHydrant}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Hydrant
                        </button>
                      </div>
                    </div>

                    {/* Shared District Hydrants Picker Drawer */}
                    {showHydrantPicker ? (
                      <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/40 dark:bg-blue-950/30">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
                          <div>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-950 dark:text-blue-200">
                              District Hydrant Pool
                            </h4>
                            <p className="text-[11px] text-blue-700 dark:text-blue-300">
                              Select existing district hydrants. Hydrants are sorted by proximity to this occupancy when coordinates are available.
                            </p>
                          </div>
                          <div className="relative w-full sm:w-64">
                            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                            <input
                              type="text"
                              value={hydrantSearch}
                              onChange={(e) => setHydrantSearch(e.target.value)}
                              placeholder="Search tag, street address, notes..."
                              className="w-full rounded-lg border border-blue-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                            />
                          </div>
                        </div>

                        {availableExistingHydrants.length > 0 ? (
                          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                            {availableExistingHydrants.map((h, hIdx) => {
                              const tag = h.id || h.hydrant_id || `Hydrant #${hIdx + 1}`;
                              const isAdded = attachedHydrantIds.has(tag.trim().toLowerCase());
                              const hasCoords = Number.isFinite(h.latitude) && Number.isFinite(h.longitude);

                              return (
                                <div
                                  key={h.hydrant_id || h.id || hIdx}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-white p-2.5 text-xs shadow-xs dark:border-slate-800 dark:bg-slate-900"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-bold text-slate-900 dark:text-white">
                                        {tag}
                                      </span>
                                      <span
                                        className={`rounded px-1.5 py-0.2 uppercase text-[9px] font-semibold ${
                                          h.status === 'out-of-service'
                                            ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                        }`}
                                      >
                                        {h.status === 'out-of-service' ? 'Out of service' : 'In service'}
                                      </span>
                                      <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase">
                                        ({h.type || 'dry'})
                                      </span>
                                      {h.flow ? (
                                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                                          {h.flow} GPM
                                        </span>
                                      ) : null}
                                      {h.calculatedDistanceFeet !== null ? (
                                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                                          {formatDistance(h.calculatedDistanceFeet)} away
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-slate-300">
                                      {h.address || 'No street address specified'}
                                      {hasCoords ? ` · GPS: ${h.latitude.toFixed(5)}, ${h.longitude.toFixed(5)}` : ''}
                                      {h.notes ? ` · Note: ${h.notes}` : ''}
                                    </div>
                                  </div>

                                  <div>
                                    {isAdded ? (
                                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                                        Already Added
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => selectExistingHydrant(h)}
                                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-blue-500 shadow-xs"
                                      >
                                        <Plus className="h-3 w-3" />
                                        Add to Plan
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-xl bg-white p-4 text-center text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                            No district hydrants match your search.
                          </div>
                        )}
                      </div>
                    ) : null}

                    {draft.nearby_hydrants && draft.nearby_hydrants.length > 0 ? (
                      <div className="space-y-3">
                        {draft.nearby_hydrants.map((h, i) => (
                          <div
                            key={i}
                            className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5 dark:border-slate-700 dark:bg-slate-800/60"
                          >
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="w-28">
                                <span className="block text-[10px] font-semibold uppercase text-slate-500">ID / Tag</span>
                                <input
                                  type="text"
                                  value={h.id}
                                  onChange={(e) => updateHydrant(i, 'id', e.target.value)}
                                  placeholder="H-104"
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                />
                              </div>

                              <div className="min-w-[140px] flex-1">
                                <span className="block text-[10px] font-semibold uppercase text-slate-500">Closest Address</span>
                                <input
                                  type="text"
                                  value={h.address}
                                  onChange={(e) => updateHydrant(i, 'address', e.target.value)}
                                  placeholder="Main St & 3rd Ave"
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                />
                              </div>

                              <div className="w-24">
                                <span className="block text-[10px] font-semibold uppercase text-slate-500">Flow (GPM)</span>
                                <input
                                  type="number"
                                  value={h.flow ?? ''}
                                  onChange={(e) => updateHydrant(i, 'flow', e.target.value ? Number(e.target.value) : null)}
                                  placeholder="1250"
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                />
                              </div>

                              <div className="w-28">
                                <span className="block text-[10px] font-semibold uppercase text-slate-500">Status</span>
                                <select
                                  value={h.status}
                                  onChange={(e) => updateHydrant(i, 'status', e.target.value)}
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                >
                                  {HYDRANT_STATUSES.map((s) => (
                                    <option key={s.value} value={s.value}>{s.label}</option>
                                  ))}
                                </select>
                              </div>

                              <div className="w-24">
                                <span className="block text-[10px] font-semibold uppercase text-slate-500">Barrel Type</span>
                                <select
                                  value={h.type}
                                  onChange={(e) => updateHydrant(i, 'type', e.target.value)}
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                >
                                  {HYDRANT_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                  ))}
                                </select>
                              </div>

                              <div className="pt-4">
                                <button
                                  type="button"
                                  onClick={() => removeHydrant(i)}
                                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                  title="Remove hydrant from plan"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>

                            {/* Row 2: GPS Coordinates, Auto-Distance, and Notes */}
                            <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                              <div className="w-32">
                                <span className="block text-[10px] font-semibold uppercase text-slate-500">Latitude</span>
                                <input
                                  type="number"
                                  step="any"
                                  value={h.latitude ?? ''}
                                  onChange={(e) => updateHydrant(i, 'latitude', e.target.value)}
                                  placeholder="e.g. 33.918234"
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-mono dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                />
                              </div>

                              <div className="w-32">
                                <span className="block text-[10px] font-semibold uppercase text-slate-500">Longitude</span>
                                <input
                                  type="number"
                                  step="any"
                                  value={h.longitude ?? ''}
                                  onChange={(e) => updateHydrant(i, 'longitude', e.target.value)}
                                  placeholder="e.g. -78.129482"
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-mono dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                />
                              </div>

                              <div className="w-36">
                                <div className="flex items-center justify-between">
                                  <span className="block text-[10px] font-semibold uppercase text-slate-500">Distance</span>
                                  {Number.isFinite(draft.latitude) &&
                                  Number.isFinite(draft.longitude) &&
                                  Number.isFinite(h.latitude) &&
                                  Number.isFinite(h.longitude) ? (
                                    <button
                                      type="button"
                                      onClick={() => recalculateHydrantDistance(i)}
                                      className="text-[10px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                                      title="Recalculate distance between building and hydrant coordinates"
                                    >
                                      Auto-calc
                                    </button>
                                  ) : null}
                                </div>
                                <input
                                  type="text"
                                  value={h.distance}
                                  onChange={(e) => updateHydrant(i, 'distance', e.target.value)}
                                  placeholder="e.g. 150 ft"
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                />
                              </div>

                              <div className="min-w-[140px] flex-1">
                                <span className="block text-[10px] font-semibold uppercase text-slate-500">Location Notes / Couplings</span>
                                <input
                                  type="text"
                                  value={h.notes || ''}
                                  onChange={(e) => updateHydrant(i, 'notes', e.target.value)}
                                  placeholder="e.g. 5-inch Storz on North side of road"
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400 dark:border-slate-700">
                        No nearby hydrants listed. Click "Select Existing Hydrant" or "Add Hydrant" above to record one.
                      </div>
                    )}
                  </div>
                ) : null}

                {/* TAB 5: HazMat & Chemical Inventory */}
                {activeTab === 'chemicals' ? (
                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        HazMat Overview (Brief Summary of Primary Hazards)
                      </span>
                      <input
                        type="text"
                        value={draft.hazmat}
                        onChange={(e) => updateField('hazmat', e.target.value)}
                        placeholder="e.g. Class 3 Flammable Liquids, Ammonia Refrigeration in rear"
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Chemical Inventory (Full List, Quantities, SDS Locations, Storage Details)
                      </span>
                      <textarea
                        rows={8}
                        value={draft.chemical_inventory}
                        onChange={(e) => updateField('chemical_inventory', e.target.value)}
                        placeholder="Detail chemical names, UN numbers, quantities, storage locations (e.g., Room 104, bunker 2), special firefighting extinguishing agents, and emergency contact details..."
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>
                  </div>
                ) : null}

                {/* TAB 6: Emergency Contacts */}
                {activeTab === 'contacts' ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Responsible persons, property managers, building engineers, and after-hours keyholders.
                      </p>
                      <button
                        type="button"
                        onClick={addContact}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Contact
                      </button>
                    </div>

                    {draft.contacts && draft.contacts.length > 0 ? (
                      <div className="space-y-3">
                        {draft.contacts.map((c, i) => (
                          <div
                            key={c.id || i}
                            className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-700 dark:bg-slate-800/60"
                          >
                            <div className="min-w-[140px] flex-1">
                              <span className="block text-[10px] font-semibold uppercase text-slate-500">Contact Name</span>
                              <input
                                type="text"
                                value={c.name}
                                onChange={(e) => updateContact(i, 'name', e.target.value)}
                                placeholder="Jane Doe"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                              />
                            </div>

                            <div className="w-36">
                              <span className="block text-[10px] font-semibold uppercase text-slate-500">Role / Description</span>
                              <input
                                type="text"
                                value={c.description}
                                onChange={(e) => updateContact(i, 'description', e.target.value)}
                                placeholder="Property Manager"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                              />
                            </div>

                            <div className="w-36">
                              <span className="block text-[10px] font-semibold uppercase text-slate-500">Phone Number</span>
                              <input
                                type="text"
                                value={c.phone}
                                onChange={(e) => updateContact(i, 'phone', e.target.value)}
                                placeholder="910-555-0123"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                              />
                            </div>

                            <div className="min-w-[140px] flex-1">
                              <span className="block text-[10px] font-semibold uppercase text-slate-500">Address / Notes</span>
                              <input
                                type="text"
                                value={c.address}
                                onChange={(e) => updateContact(i, 'address', e.target.value)}
                                placeholder="On-site office Apt 101"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                              />
                            </div>

                            <div className="pt-4">
                              <button
                                type="button"
                                onClick={() => removeContact(i)}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400 dark:border-slate-700">
                        No contacts listed. Click "Add Contact" above to add one.
                      </div>
                    )}
                  </div>
                ) : null}

                {/* TAB 7: Diagrams & Attached Files */}
                {activeTab === 'files' ? (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          Building Diagrams & Tactical Files
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Upload floor plans, aerial views, utility shut-off diagrams, or take a picture on site (PDFs or images up to 25MB).
                        </p>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileUpload}
                        accept="image/*,.pdf,.doc,.docx,.txt"
                        className="hidden"
                      />
                      <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleCameraCapture}
                        className="hidden"
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={uploadingFile}
                          onClick={() => {
                            if (navigator?.mediaDevices?.getUserMedia) {
                              setCameraModalOpen(true);
                            } else {
                              cameraInputRef.current?.click();
                            }
                          }}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
                        >
                          <Camera className="h-4 w-4" />
                          <span>Take Photo</span>
                        </button>
                        <button
                          type="button"
                          disabled={uploadingFile}
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50"
                        >
                          {uploadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          {uploadingFile ? `Uploading ${uploadProgress}%...` : 'Upload File / Diagram'}
                        </button>
                      </div>
                    </div>

                    {fileUploadError ? (
                      <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                        <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                        <span>{fileUploadError}</span>
                      </div>
                    ) : null}

                    {/* Drag & Drop / Click Upload Target */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div
                        onClick={() => !uploadingFile && fileInputRef.current?.click()}
                        className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-5 text-center cursor-pointer transition hover:border-blue-400 hover:bg-blue-50/30 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-blue-500"
                      >
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                          <FileUp className="h-5 w-5" />
                        </div>
                        <span className="mt-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                          Click to browse or drop tactical files here
                        </span>
                        <span className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          Floor plans, CAD exports, and PDFs
                        </span>
                      </div>

                      <div
                        onClick={() => {
                          if (uploadingFile) return;
                          if (navigator?.mediaDevices?.getUserMedia) {
                            setCameraModalOpen(true);
                          } else {
                            cameraInputRef.current?.click();
                          }
                        }}
                        className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-300/80 bg-emerald-50/40 p-5 text-center cursor-pointer transition hover:border-emerald-500 hover:bg-emerald-50/70 dark:border-emerald-800/60 dark:bg-emerald-950/20 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/40"
                      >
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                          <Camera className="h-5 w-5" />
                        </div>
                        <span className="mt-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                          Take a picture directly with camera
                        </span>
                        <span className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          Snap photos on site with device or camera app
                        </span>
                      </div>
                    </div>

                    {/* Attached Files Grid */}
                    {draft.files && draft.files.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {draft.files.map((file, i) => {
                          const isImg =
                            file.contentType?.startsWith('image/') ||
                            file.type?.startsWith('image/') ||
                            /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || '');
                          const previewSrc = file.dataUrl || file.downloadUrl;

                          return (
                            <div
                              key={file.fileId || file.storagePath || i}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-700 dark:bg-slate-800/70"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                {isImg && previewSrc ? (
                                  <img
                                    src={previewSrc}
                                    alt={file.name}
                                    className="h-14 w-14 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                                  />
                                ) : (
                                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                                    <FileText className="h-7 w-7" />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-bold text-slate-900 dark:text-white" title={file.name}>
                                    {file.name || 'Unnamed File'}
                                  </p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {file.size ? formatFileSize(file.size) : 'File'}
                                    {file.uploadedAt ? ` · ${new Date(file.uploadedAt).toLocaleDateString()}` : ''}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => openPreplanFile(file)}
                                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                                  >
                                    <Eye className="h-3 w-3" /> View / Preview
                                  </button>
                                </div>
                              </div>

                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFile(i)}
                                  className="rounded-xl p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                  title="Remove file"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
                        No diagrams or files attached yet.
                      </div>
                    )}
                  </div>
                ) : null}

                {/* TAB 8: Building Satellite Map & Tactical Plotting */}
                {activeTab === 'site_map' ? (
                  <div className="space-y-4">
                    <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Satellite Building Map & Special Landmarks
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Zoomed-in aerial satellite view centered on the structure. Plot special tactical landmarks (FDC, sprinkler risers, electrical/gas shutoffs, Knox boxes, and roof access points).
                      </p>
                    </div>

                    <PreplanBuildingMap
                      plan={draft}
                      editable={true}
                      onChangeLandmarks={(newLandmarks) => {
                        setDraft((cur) => ({ ...cur, building_landmarks: newLandmarks }));
                      }}
                      onChangeCoordinates={({ latitude, longitude }) => {
                        setDraft((cur) => ({ ...cur, latitude, longitude }));
                      }}
                    />
                  </div>
                ) : null}

                {/* TAB 9: Annual Site Inspections Log & Compliance */}
                {activeTab === 'inspections' ? (
                  <div className="space-y-4">
                    <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Annual Site Inspections & Compliance Log
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Record periodic site and safety inspections. Every preplan requires an inspection annually, no more than 365 days from the last inspection date.
                      </p>
                    </div>

                    {/* Subform to add inspection */}
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                        Add Inspection Entry
                      </h4>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            Inspection Date *
                          </label>
                          <input
                            type="date"
                            value={newInspection.inspection_date}
                            onChange={(e) =>
                              setNewInspection((prev) => ({ ...prev, inspection_date: e.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            Inspector Name
                          </label>
                          <input
                            type="text"
                            placeholder={currentUser?.name || 'Inspector Name'}
                            value={newInspection.inspector_name}
                            onChange={(e) =>
                              setNewInspection((prev) => ({ ...prev, inspector_name: e.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            Result / Status
                          </label>
                          <select
                            value={newInspection.status}
                            onChange={(e) =>
                              setNewInspection((prev) => ({ ...prev, status: e.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          >
                            {INSPECTION_STATUSES.map((st) => (
                              <option key={st.value} value={st.value}>
                                {st.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="mt-3">
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          Notes & Findings
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Passed annual life safety check, riser tags verified..."
                          value={newInspection.notes}
                          onChange={(e) =>
                            setNewInspection((prev) => ({ ...prev, notes: e.target.value }))
                          }
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>

                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={handleAddInspection}
                          disabled={!newInspection.inspection_date}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Inspection
                        </button>
                      </div>
                    </div>

                    {/* Table of existing inspections */}
                    {draft.site_inspections && draft.site_inspections.length > 0 ? (
                      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
                            <tr>
                              <th className="px-3 py-2.5">Date</th>
                              <th className="px-3 py-2.5">Inspector</th>
                              <th className="px-3 py-2.5">Status</th>
                              <th className="px-3 py-2.5">Next Due (+365d)</th>
                              <th className="px-3 py-2.5">Notes</th>
                              <th className="px-3 py-2.5 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                            {draft.site_inspections.map((insp, idx) => {
                              const stObj = INSPECTION_STATUSES.find((s) => s.value === insp.status);
                              let nextDue = '—';
                              if (insp.inspection_date) {
                                const d = new Date(insp.inspection_date);
                                const nextD = new Date(d.getTime() + 365 * 24 * 60 * 60 * 1000);
                                nextDue = nextD.toISOString().split('T')[0];
                              }
                              return (
                                <tr key={insp.id || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                                  <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">
                                    {insp.inspection_date || '—'}
                                  </td>
                                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                    {insp.inspector_name || '—'}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                      {stObj?.label || insp.status || 'Passed'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">
                                    {nextDue}
                                  </td>
                                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                                    {insp.notes || '—'}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveInspection(idx)}
                                      className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                      title="Remove inspection entry"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
                        No inspections recorded yet.
                      </div>
                    )}
                  </div>
                ) : null}

                {/* TAB 10: Operational & Field Notes Log */}
                {activeTab === 'notes' ? (
                  <div className="space-y-4">
                    <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Operational & Field Notes Log
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Running log of field notes, gate codes, Knox lock locations, or hazard alerts. Automatically captures author and timestamp.
                      </p>
                    </div>

                    {/* Add note subform */}
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1 font-medium">
                          <User className="h-3.5 w-3.5 text-blue-500" />
                          Posting as <strong className="text-slate-800 dark:text-slate-200">{currentUser?.name || 'Crew Member'}</strong>
                        </span>
                        <span className="text-[11px]">{new Date().toLocaleDateString()}</span>
                      </div>
                      <textarea
                        rows={2}
                        value={newNoteInput}
                        onChange={(e) => setNewNoteInput(e.target.value)}
                        placeholder="Write a field note or hazard update..."
                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={handleAddNote}
                          disabled={!newNoteInput.trim()}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Note
                        </button>
                      </div>
                    </div>

                    {/* Running notes list */}
                    {draft.notes && draft.notes.length > 0 ? (
                      <div className="space-y-3">
                        {draft.notes.map((note, idx) => (
                          <div
                            key={note.id || idx}
                            className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs dark:border-slate-700 dark:bg-slate-800"
                          >
                            <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 text-xs dark:border-slate-700">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 dark:text-white">
                                  {note.author_name || 'Crew Member'}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {note.created_at ? new Date(note.created_at).toLocaleString() : ''}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveNote(idx)}
                                className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                title="Remove note"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300">
                              {note.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
                        No field notes recorded yet.
                      </div>
                    )}
                  </div>
                ) : null}
              </form>
            ) : viewTab === 'map' ? (
              <div className="space-y-4">
                <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Satellite Building Map & Tactical Landmarks
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    High-resolution aerial satellite view with plotted FDCs, sprinkler risers, utility shutoffs, and Knox access points.
                  </p>
                </div>
                <PreplanBuildingMap plan={draft} editable={false} />
              </div>
            ) : (
              <PreIncidentPlanView
                plan={draft}
                stationName={stationName}
                onPrint={handlePrint}
                onNavigateToMap={onNavigateToMap}
                onSave={async (updated) => {
                  setDraft(updated);
                  if (onSave) {
                    await onSave(updated);
                  }
                }}
                canEdit={canEdit}
                currentUser={currentUser}
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
            <div>
              {isEditing && draft.id && onDelete ? (
                <button
                  type="button"
                  onClick={() => setPendingDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Plan
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (!draft.id) {
                        onClose();
                      } else {
                        setIsEditing(false);
                      }
                    }}
                    className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="preplan-form"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-500 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {saving ? 'Saving...' : 'Save Pre-Incident Plan'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {pendingDelete ? (
        <ConfirmModal
          title="Delete Pre-Incident Plan"
          message={`Are you sure you want to delete the pre-incident plan for "${draft.occupancy_name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            setPendingDelete(false);
            if (onDelete) {
              await onDelete(draft);
              onClose();
            }
          }}
          onCancel={() => setPendingDelete(false)}
        />
      ) : null}

      {printing ? (
        <PrintablePreIncidentPlan
          plan={draft}
          stationName={stationName}
          onDone={() => setPrinting(false)}
        />
      ) : null}

      {cameraModalOpen && (
        <CameraCaptureModal
          isOpen={cameraModalOpen}
          onClose={() => setCameraModalOpen(false)}
          onCapture={async (file) => {
            await uploadSingleFile(file);
          }}
          onFallbackNative={() => cameraInputRef.current?.click()}
          occupancyName={draft.occupancy_name}
        />
      )}
    </>
  );
}
