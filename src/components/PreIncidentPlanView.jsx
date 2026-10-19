import React, { useState, useMemo } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Compass,
  Droplets,
  Eye,
  FileText,
  Flame,
  MapPin,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Printer,
  ShieldAlert,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { openPreplanFile } from '../services/preplanFileStorage';
import { formatFileSize } from '../utils/apparatus';
import PreplanBuildingMap from './preplans/PreplanBuildingMap';
import {
  INSPECTION_STATUSES,
  getPreplanInspectionDue,
  normalizeSiteInspection,
  normalizePreplanNote,
} from '../utils/preIncidentPlans';
import { useAuth } from '../context/AuthContext';

export default function PreIncidentPlanView({
  plan,
  stationName = '',
  onPrint,
  onNavigateToMap,
  onSave,
  canEdit = false,
  currentUser: propUser = null,
}) {
  const auth = useAuth();
  const currentUser = propUser || auth?.currentUser || null;
  const currentUserId = String(currentUser?.id || currentUser?.uid || '');

  // Subform states for inspections
  const [showAddInspection, setShowAddInspection] = useState(false);
  const [savingInspection, setSavingInspection] = useState(false);
  const [inspectionForm, setInspectionForm] = useState({
    inspection_date: new Date().toISOString().split('T')[0],
    inspector_name: currentUser?.name || currentUser?.displayName || '',
    status: 'passed',
    notes: '',
  });

  // Subform states for generic notes
  const [newNoteText, setNewNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteText, setEditingNoteText] = useState('');

  const now = useMemo(() => new Date(), []);
  const dueInfo = useMemo(() => getPreplanInspectionDue(plan, now), [plan, now]);
  if (!plan) return null;

  const fullAddress = [
    plan.address1,
    plan.address2,
    plan.city,
    plan.state ? `${plan.state} ${plan.zip_code || ''}`.trim() : plan.zip_code,
  ]
    .filter(Boolean)
    .join(', ');

  const hasCoords = Number.isFinite(plan.latitude) && Number.isFinite(plan.longitude);

  return (
    <div className="preplan-container space-y-6 text-slate-800 dark:text-slate-100">
      {/* Action / Header Bar (Hidden in Print) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 no-print dark:border-slate-700">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
              <Building2 className="h-3.5 w-3.5" />
              Pre-Incident Plan
            </span>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              ID: {plan.occupancy_id || 'Unassigned'}
            </span>
            {plan.station ? (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {plan.station}
              </span>
            ) : null}
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {plan.occupancy_name || 'Unnamed Occupancy'}
          </h2>
          {fullAddress ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
              <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
              <span>{fullAddress}</span>
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {onNavigateToMap && hasCoords ? (
            <button
              type="button"
              onClick={() => onNavigateToMap(plan)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60"
            >
              <Compass className="h-3.5 w-3.5" />
              View on District Map
            </button>
          ) : null}

          {onPrint ? (
            <button
              type="button"
              onClick={onPrint}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
          ) : null}
        </div>
      </div>

      {/* PRINT-ONLY HEADER */}
      <div className="hidden print-header print:block border-b-2 border-slate-800 pb-3 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-black uppercase tracking-wider text-slate-900">
              {plan.station || stationName || 'Fire Department'} — Pre-Incident Plan
            </h1>
            <h2 className="mt-1 text-2xl font-extrabold text-slate-900">{plan.occupancy_name}</h2>
            <p className="text-sm font-medium text-slate-700">{fullAddress}</p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p className="font-mono font-bold text-slate-900">ID: {plan.occupancy_id}</p>
            {hasCoords ? <p>GPS: {plan.latitude.toFixed(5)}, {plan.longitude.toFixed(5)}</p> : null}
            <p>Printed: {new Date().toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      {/* Critical Operational Overview Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Occupancy Type
          </span>
          <span className="mt-1 block text-sm font-bold text-slate-900 dark:text-white truncate" title={plan.occupancy_type || '—'}>
            {plan.occupancy_type || '—'}
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400 truncate" title={plan.property_use || '—'}>
            {plan.property_use || '—'}
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Construction
          </span>
          <span className="mt-1 block text-sm font-bold text-slate-900 dark:text-white truncate" title={plan.building_construction_type || '—'}>
            {plan.building_construction_type || '—'}
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            {plan.year_built ? `Built ${plan.year_built}` : 'Year unspec.'}
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Floors / Area
          </span>
          <span className="mt-1 block text-sm font-bold text-slate-900 dark:text-white">
            {plan.floors ? `${plan.floors} Floor${plan.floors === 1 ? '' : 's'}` : '—'}
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            {plan.square_footage ? `${plan.square_footage.toLocaleString()} sq ft` : 'Area unspec.'}
          </span>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900/40 dark:bg-blue-950/30">
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
            <Droplets className="h-3 w-3 text-blue-600 dark:text-blue-400" />
            Needed Flow
          </span>
          <span className="mt-1 block text-sm font-bold text-blue-950 dark:text-blue-200">
            {plan.needed_fire_flow ? `${plan.needed_fire_flow.toLocaleString()} GPM` : '—'}
          </span>
          <span className="block text-xs text-blue-700/80 dark:text-blue-400">
            Target fire flow
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Basement
          </span>
          <span className={`mt-1 inline-flex items-center gap-1 text-sm font-bold ${plan.basement_present ? 'text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
            {plan.basement_present ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                Present
              </>
            ) : (
              'None / No'
            )}
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            Subgrade level
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            HazMat Status
          </span>
          <span className={`mt-1 inline-flex items-center gap-1 text-sm font-bold ${plan.hazmat ? 'text-red-700 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
            {plan.hazmat ? (
              <>
                <ShieldAlert className="h-3.5 w-3.5 text-red-600" />
                Present
              </>
            ) : (
              'None reported'
            )}
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
            {plan.hazmat ? plan.hazmat : 'No hazards'}
          </span>
        </div>
      </div>

      {/* HazMat Alert Banner (if HazMat present) */}
      {plan.hazmat ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-3.5 text-sm text-red-900 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <span className="font-bold uppercase tracking-wide text-red-800 dark:text-red-300">Hazardous Materials Warning: </span>
            <span>{plan.hazmat}</span>
          </div>
        </div>
      ) : null}

      {/* Detailed Sections Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* SECTION 1: Occupancy & Identification */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <h3 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold uppercase tracking-wider text-slate-900 dark:border-slate-700 dark:text-white">
            <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            Occupancy & Identification
          </h3>
          <dl className="mt-3 divide-y divide-slate-100 text-xs dark:divide-slate-700/60">
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Occupancy ID</dt>
              <dd className="font-mono font-medium text-slate-900 dark:text-white">{plan.occupancy_id || '—'}</dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Street Address</dt>
              <dd className="font-medium text-slate-900 dark:text-white text-right">{fullAddress || '—'}</dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">GPS Coordinates</dt>
              <dd className="font-mono font-medium text-slate-900 dark:text-white">
                {hasCoords ? `${plan.latitude.toFixed(6)}, ${plan.longitude.toFixed(6)}` : '—'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Occupancy Type / Use</dt>
              <dd className="font-medium text-slate-900 dark:text-white text-right">
                {plan.occupancy_type || '—'} {plan.property_use ? `(${plan.property_use})` : ''}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Phone / Email</dt>
              <dd className="font-medium text-slate-900 dark:text-white text-right">
                {plan.primary_phone ? <span>{plan.primary_phone}</span> : null}
                {plan.primary_email ? <span className="block text-slate-500 dark:text-slate-400">{plan.primary_email}</span> : null}
                {!plan.primary_phone && !plan.primary_email ? '—' : null}
              </dd>
            </div>
            {plan.primary_fax ? (
              <div className="py-2 flex justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Primary Fax</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{plan.primary_fax}</dd>
              </div>
            ) : null}
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">ISO ID / Utility No.</dt>
              <dd className="font-medium text-slate-900 dark:text-white text-right">
                {plan.iso_id || '—'} / {plan.utility_billing_number || '—'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">National Grid / Parcel (APN)</dt>
              <dd className="font-medium text-slate-900 dark:text-white text-right">
                {plan.national_grid || '—'} / {plan.assessor_parcel_number || '—'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Business License</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{plan.business_license_number || '—'}</dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Assessed Value</dt>
              <dd className="font-medium text-slate-900 dark:text-white">
                {plan.assessed_value ? `$${plan.assessed_value.toLocaleString()}` : '—'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Inspector / Station / Zone</dt>
              <dd className="font-medium text-slate-900 dark:text-white text-right">
                {plan.assigned_inspector || 'Unassigned'} · {plan.station || 'Station'} · {plan.occupancy_zone || 'Zone —'}
              </dd>
            </div>
            {plan.critical_infrastructure ? (
              <div className="py-2 flex justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Critical Infrastructure</dt>
                <dd className="font-medium text-amber-700 dark:text-amber-400">{plan.critical_infrastructure}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {/* SECTION 2: Building Construction & Prefire Info */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <h3 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold uppercase tracking-wider text-slate-900 dark:border-slate-700 dark:text-white">
            <Flame className="h-4 w-4 text-red-600 dark:text-red-400" />
            Building Construction & Prefire
          </h3>
          <dl className="mt-3 divide-y divide-slate-100 text-xs dark:divide-slate-700/60">
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Construction Type</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{plan.building_construction_type || '—'}</dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Dimensions (L × W × H)</dt>
              <dd className="font-medium text-slate-900 dark:text-white">
                {plan.building_length || '—'}′ L × {plan.building_width || '—'}′ W × {plan.building_height || '—'}′ H
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Roof (Type / Mat. / Const.)</dt>
              <dd className="font-medium text-slate-900 dark:text-white text-right">
                {[plan.roof_type, plan.roof_material, plan.roof_construction].filter(Boolean).join(' · ') || '—'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Master Key Location</dt>
              <dd className="font-semibold text-slate-900 dark:text-white text-right">{plan.master_key_location || '—'}</dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Fire Alarm Panel</dt>
              <dd className="font-medium text-slate-900 dark:text-white text-right">{plan.fire_alarm_panel_location || '—'}</dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Electrical Panel</dt>
              <dd className="font-medium text-slate-900 dark:text-white text-right">{plan.electrical_panel_location || '—'}</dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Gas / LPG Shutoff</dt>
              <dd className="font-semibold text-amber-700 dark:text-amber-400 text-right">{plan.gas_lpg_shutoff_location || '—'}</dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Building Access / Hours</dt>
              <dd className="font-medium text-slate-900 dark:text-white text-right">
                {plan.building_access || '—'} {plan.hours_of_occupancy ? `(${plan.hours_of_occupancy})` : ''}
              </dd>
            </div>
            {plan.access_problems ? (
              <div className="py-2 flex justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Access Problems</dt>
                <dd className="font-medium text-amber-700 dark:text-amber-400 text-right">{plan.access_problems}</dd>
              </div>
            ) : null}
            {plan.ventilation_problems ? (
              <div className="py-2 flex justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Ventilation Problems</dt>
                <dd className="font-medium text-amber-700 dark:text-amber-400 text-right">{plan.ventilation_problems}</dd>
              </div>
            ) : null}
            {plan.exposure_info ? (
              <div className="py-2 flex justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Exposure Information</dt>
                <dd className="font-medium text-slate-900 dark:text-white text-right">{plan.exposure_info}</dd>
              </div>
            ) : null}
            {plan.other_location_info ? (
              <div className="py-2 flex justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Other Location Info</dt>
                <dd className="font-medium text-slate-900 dark:text-white text-right">{plan.other_location_info}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>

      {/* SECTION 3: Fire Protection Systems & Water Supply */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
        <h3 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold uppercase tracking-wider text-slate-900 dark:border-slate-700 dark:text-white">
          <Droplets className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          Fire Protection Systems & Water Supply
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/40">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">FDC Locations</div>
            <div className="mt-1 font-bold text-blue-700 dark:text-blue-300">{plan.fdc_locations || '—'}</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/40">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Sprinkler Room Location</div>
            <div className="mt-1 font-semibold text-slate-900 dark:text-white">{plan.sprinkler_room_location || '—'}</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/40">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Water Supply Information</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-white">{plan.water_supply_info || '—'}</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/40">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Needed Fire Flow</div>
            <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
              {plan.needed_fire_flow ? `${plan.needed_fire_flow.toLocaleString()} GPM` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 4: Nearby Hydrants */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
        <h3 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold uppercase tracking-wider text-slate-900 dark:border-slate-700 dark:text-white">
          <Droplets className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          Nearby Hydrants ({plan.nearby_hydrants?.length || 0})
        </h3>
        {plan.nearby_hydrants && plan.nearby_hydrants.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-4 font-semibold whitespace-nowrap">ID / Tag</th>
                  <th className="py-2 pr-4 font-semibold min-w-[200px]">Closest Address</th>
                  <th className="py-2 pr-4 font-semibold whitespace-nowrap">Distance</th>
                  <th className="py-2 pr-4 font-semibold whitespace-nowrap">Flow</th>
                  <th className="py-2 pr-4 font-semibold whitespace-nowrap">Status / Type</th>
                  <th className="py-2 font-semibold whitespace-nowrap">Coordinates</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {plan.nearby_hydrants.map((h, i) => {
                  const hasCoords = Number.isFinite(h.latitude) && Number.isFinite(h.longitude);
                  return (
                    <tr key={h.id || i} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                      <td className="py-2.5 pr-4 font-mono font-medium text-slate-900 dark:text-white whitespace-nowrap">{h.id || `#${i + 1}`}</td>
                      <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">
                        <div>{h.address || '—'}</div>
                        {h.notes ? <div className="text-[10px] italic text-slate-400">{h.notes}</div> : null}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {h.distance ? (typeof h.distance === 'number' ? `${h.distance.toLocaleString()} ft` : `${h.distance}`) : '—'}
                      </td>
                      <td className="py-2.5 pr-4 font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                        {h.flow ? `${h.flow} gpm` : '—'}
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                            h.status === 'out-of-service'
                              ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}
                        >
                          {h.status === 'out-of-service' ? 'Out of service' : 'In service'}
                        </span>
                        <span className="ml-1 text-[10px] text-slate-400">({h.type || 'dry'})</span>
                      </td>
                      <td className="py-2.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {hasCoords ? `${h.latitude.toFixed(5)}, ${h.longitude.toFixed(5)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-xs italic text-slate-400">No nearby hydrants listed.</p>
        )}
      </div>

      {/* SECTION 5: Chemical Inventory & Contacts */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Chemical Inventory */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <h3 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold uppercase tracking-wider text-slate-900 dark:border-slate-700 dark:text-white">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Chemical Inventory & Hazardous Substances
          </h3>
          {plan.chemical_inventory ? (
            <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60">
              {plan.chemical_inventory}
            </pre>
          ) : (
            <p className="mt-3 text-xs italic text-slate-400">No chemical inventory recorded.</p>
          )}
        </div>

        {/* Emergency Contacts */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <h3 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold uppercase tracking-wider text-slate-900 dark:border-slate-700 dark:text-white">
            <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            Emergency Contacts ({plan.contacts?.length || 0})
          </h3>
          {plan.contacts && plan.contacts.length > 0 ? (
            <div className="mt-3 space-y-3">
              {plan.contacts.map((c, i) => (
                <div key={c.id || i} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white">{c.name || 'Unnamed Contact'}</span>
                    <span className="rounded bg-slate-200/60 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {c.description || 'Contact'}
                    </span>
                  </div>
                  {c.phone ? (
                    <div className="mt-1 flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <Phone className="h-3.5 w-3.5 text-slate-400" />
                      <a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a>
                    </div>
                  ) : null}
                  {c.address ? (
                    <div className="mt-1 text-slate-500 dark:text-slate-400">
                      Address: {c.address}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs italic text-slate-400">No emergency contacts listed.</p>
          )}
        </div>
      </div>

      {/* SECTION 6: Prefire Plan Operational Notes */}
      {plan.prefire_plan_notes ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <h3 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold uppercase tracking-wider text-slate-900 dark:border-slate-700 dark:text-white">
            <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Tactical & Operational Notes
          </h3>
          <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-300">
            {plan.prefire_plan_notes}
          </p>
        </div>
      ) : null}

      {/* SECTION 7: Diagrams & Attached Files */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
        <h3 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold uppercase tracking-wider text-slate-900 dark:border-slate-700 dark:text-white">
          <Paperclip className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          Tactical Diagrams & Attached Documents ({plan.files?.length || 0})
        </h3>
        {plan.files && plan.files.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plan.files.map((file, i) => {
              const isImg =
                file.contentType?.startsWith('image/') ||
                file.type?.startsWith('image/') ||
                /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || '');
              const previewSrc = file.dataUrl || file.downloadUrl;

              return (
                <div
                  key={file.fileId || file.storagePath || i}
                  onClick={() => openPreplanFile(file)}
                  className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-blue-600"
                >
                  {isImg && previewSrc ? (
                    <img
                      src={previewSrc}
                      alt={file.name}
                      className="h-16 w-16 shrink-0 rounded-xl border border-slate-200 object-cover shadow-xs dark:border-slate-700"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                      <FileText className="h-8 w-8" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                      {file.name || 'Unnamed Document'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {file.size ? formatFileSize(file.size) : 'File'}
                    </p>
                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                      <Eye className="h-3 w-3" /> View Document
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-xs italic text-slate-400">No building diagrams or files attached.</p>
        )}
      </div>

      {/* SECTION 8: Building Satellite Map & Tactical Landmarks */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
        <h3 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold uppercase tracking-wider text-slate-900 dark:border-slate-700 dark:text-white">
          <MapPin className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          Satellite Building Map & Tactical Landmarks ({plan.building_landmarks?.length || 0})
        </h3>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Structure-focused aerial imagery showing exact positions of FDCs, sprinkler risers, utility shutoffs, and Knox access points.
        </p>
        <div className="mt-4">
          <PreplanBuildingMap plan={plan} editable={false} />
        </div>
      </div>

      {/* SECTION 9: Annual Site Inspections & Compliance Table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3 dark:border-slate-700">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
              <ClipboardCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Annual Site Inspections ({plan.site_inspections?.length || 0})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Running log of physical site inspections. Preplans must be inspected annually (no more than 365 days from the last inspection).
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowAddInspection((prev) => !prev);
              setInspectionForm({
                inspection_date: new Date().toISOString().split('T')[0],
                inspector_name: currentUser?.name || currentUser?.displayName || '',
                status: 'passed',
                notes: '',
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900"
          >
            {showAddInspection ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showAddInspection ? 'Cancel' : 'Record Site Inspection'}
          </button>
        </div>

        {/* Compliance Status Callout */}
        <div className="mt-4">
          {dueInfo.isOverdue ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <div>
                <p className="font-bold">Annual Inspection Overdue</p>
                <p className="mt-0.5 text-red-700 dark:text-red-300">
                  Due date was <strong>{dueInfo.nextDueDateString}</strong> ({Math.abs(dueInfo.daysRemaining)} days overdue).
                  Department standards mandate annual inspection within 365 days of the last inspection date.
                </p>
              </div>
            </div>
          ) : dueInfo.isDueThisMonth ? (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-bold">Annual Inspection Due This Month</p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                  Site inspection is due by <strong>{dueInfo.nextDueDateString}</strong> ({dueInfo.daysRemaining} days remaining).
                </p>
              </div>
            </div>
          ) : dueInfo.hasRecord ? (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="font-bold">Inspection Up to Date</p>
                <p className="mt-0.5 text-emerald-700 dark:text-emerald-300">
                  Last inspected on <strong>{dueInfo.latestInspection?.inspection_date}</strong>. Next annual inspection is due on <strong>{dueInfo.nextDueDateString}</strong> ({dueInfo.daysRemaining} days remaining).
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-bold">No Inspection on Record</p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                  An initial site inspection should be conducted. Target due date is <strong>{dueInfo.nextDueDateString}</strong>.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Add Inspection Subform */}
        {showAddInspection ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!inspectionForm.inspection_date) return;
              setSavingInspection(true);
              try {
                const record = normalizeSiteInspection({
                  ...inspectionForm,
                  inspector_id: currentUserId,
                  created_by: currentUser?.name || 'Crew Member',
                });
                const updated = {
                  ...plan,
                  site_inspections: [record, ...(plan.site_inspections || [])],
                };
                if (typeof onSave === 'function') {
                  await onSave(updated);
                }
                setShowAddInspection(false);
              } finally {
                setSavingInspection(false);
              }
            }}
            className="mt-4 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-800/50 dark:bg-emerald-950/20"
          >
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">Record New Site Inspection</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Inspection Date *
                </label>
                <input
                  type="date"
                  required
                  value={inspectionForm.inspection_date}
                  onChange={(e) => setInspectionForm((prev) => ({ ...prev, inspection_date: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Inspector Name *
                </label>
                <input
                  type="text"
                  required
                  value={inspectionForm.inspector_name}
                  onChange={(e) => setInspectionForm((prev) => ({ ...prev, inspector_name: e.target.value }))}
                  placeholder="e.g. Capt. J. Miller"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Result / Status *
                </label>
                <select
                  value={inspectionForm.status}
                  onChange={(e) => setInspectionForm((prev) => ({ ...prev, status: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  {INSPECTION_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Inspection Findings & Notes
              </label>
              <textarea
                rows={2}
                value={inspectionForm.notes}
                onChange={(e) => setInspectionForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Physical walk-through findings, Knox box verified, riser room checked, access verified..."
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                Next inspection will be automatically due 365 days later on{' '}
                <strong className="text-slate-700 dark:text-slate-200">
                  {inspectionForm.inspection_date
                    ? new Date(new Date(inspectionForm.inspection_date).getTime() + 365 * 86400000).toISOString().split('T')[0]
                    : '—'}
                </strong>.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddInspection(false)}
                  className="rounded-xl px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-200/60 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingInspection}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {savingInspection ? 'Saving…' : 'Save Inspection'}
                </button>
              </div>
            </div>
          </form>
        ) : null}

        {/* Inspections Table */}
        <div className="mt-4 overflow-x-auto">
          {plan.site_inspections && plan.site_inspections.length > 0 ? (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                  <th className="py-2.5 px-3">Inspection Date</th>
                  <th className="py-2.5 px-3">Inspector</th>
                  <th className="py-2.5 px-3">Status / Result</th>
                  <th className="py-2.5 px-3">Next Due (365d)</th>
                  <th className="py-2.5 px-3">Findings & Notes</th>
                  {(canEdit || onSave) ? <th className="py-2.5 px-3 text-right">Action</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {plan.site_inspections.map((insp, idx) => {
                  const nextDue = insp.inspection_date
                    ? new Date(new Date(insp.inspection_date).getTime() + 365 * 86400000).toISOString().split('T')[0]
                    : '—';
                  const statusObj = INSPECTION_STATUSES.find((s) => s.value === insp.status) || INSPECTION_STATUSES[0];

                  return (
                    <tr key={insp.id || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                        {insp.inspection_date || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                        {insp.inspector_name || 'Inspector'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                            statusObj.color === 'emerald'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : statusObj.color === 'amber'
                              ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300'
                              : statusObj.color === 'red'
                              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300'
                              : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300'
                          }`}
                        >
                          {statusObj.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-600 dark:text-slate-300">
                        {nextDue}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 max-w-xs truncate" title={insp.notes}>
                        {insp.notes || '—'}
                      </td>
                      {(canEdit || onSave) ? (
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={async () => {
                              const updated = {
                                ...plan,
                                site_inspections: plan.site_inspections.filter((_, i) => i !== idx),
                              };
                              if (typeof onSave === 'function') {
                                await onSave(updated);
                              }
                            }}
                            className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                            title="Delete inspection"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
              No site inspections logged for this preplan yet. Click "Record Site Inspection" above to add the first inspection.
            </div>
          )}
        </div>
      </div>

      {/* SECTION 10: Generic Notes Log Subform */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col gap-1 border-b border-slate-100 pb-3 dark:border-slate-700">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
            <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            Operational & Field Notes Log ({plan.notes?.length || 0})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Running log of generic notes, hazard notices, gate codes, and updates. Automatically captures author and timestamp.
            Each note can only be edited by the user who wrote it.
          </p>
        </div>

        {/* Add Note Subform */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newNoteText.trim()) return;
            setSavingNote(true);
            try {
              const noteRecord = normalizePreplanNote({
                content: newNoteText.trim(),
                author_id: currentUserId,
                author_name: currentUser?.name || currentUser?.displayName || 'Crew Member',
                created_at: new Date().toISOString(),
              });
              const updated = {
                ...plan,
                notes: [noteRecord, ...(plan.notes || [])],
              };
              if (typeof onSave === 'function') {
                await onSave(updated);
              }
              setNewNoteText('');
            } finally {
              setSavingNote(false);
            }
          }}
          className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-700 dark:bg-slate-900/50"
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <User className="h-3.5 w-3.5 text-blue-500" />
              Posting as <strong className="text-slate-800 dark:text-slate-200">{currentUser?.name || 'Crew Member'}</strong>
            </span>
            <span className="text-[11px]">{new Date().toLocaleDateString()}</span>
          </div>

          <textarea
            rows={2}
            required
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            placeholder="Write a field note, gate combo, occupancy change, or response warning..."
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />

          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={savingNote || !newNoteText.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {savingNote ? 'Posting…' : 'Add Note'}
            </button>
          </div>
        </form>

        {/* Notes Running List */}
        <div className="mt-4 space-y-3">
          {plan.notes && plan.notes.length > 0 ? (
            plan.notes.map((note) => {
              const isAuthor =
                Boolean(currentUserId) &&
                (String(note.author_id) === currentUserId ||
                  (currentUser?.name && String(note.author_name).toLowerCase() === String(currentUser.name).toLowerCase()));
              const isEditingThis = editingNoteId === note.id;

              return (
                <div
                  key={note.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-700 dark:bg-slate-800/80"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs dark:border-slate-700/60">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold dark:bg-blue-950 dark:text-blue-300">
                        {(note.author_name || 'U').charAt(0).toUpperCase()}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white">
                        {note.author_name || 'Crew Member'}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {note.created_at ? new Date(note.created_at).toLocaleString() : ''}
                      </span>
                      {note.updated_at ? (
                        <span className="text-[10px] italic text-slate-400">
                          (edited {new Date(note.updated_at).toLocaleDateString()})
                        </span>
                      ) : null}
                    </div>

                    {isAuthor ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (isEditingThis) {
                              setEditingNoteId(null);
                            } else {
                              setEditingNoteId(note.id);
                              setEditingNoteText(note.content);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                        >
                          <Pencil className="h-3 w-3" />
                          {isEditingThis ? 'Cancel' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const updated = {
                              ...plan,
                              notes: (plan.notes || []).filter((n) => n.id !== note.id),
                            };
                            if (typeof onSave === 'function') {
                              await onSave(updated);
                            }
                          }}
                          className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                          title="Delete your note"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {isEditingThis ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        rows={2}
                        value={editingNoteText}
                        onChange={(e) => setEditingNoteText(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingNoteId(null)}
                          className="rounded-xl px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!editingNoteText.trim()) return;
                            const updatedNotes = (plan.notes || []).map((n) => {
                              if (n.id === note.id) {
                                return {
                                  ...n,
                                  content: editingNoteText.trim(),
                                  updated_at: new Date().toISOString(),
                                };
                              }
                              return n;
                            });
                            const updated = {
                              ...plan,
                              notes: updatedNotes,
                            };
                            if (typeof onSave === 'function') {
                              await onSave(updated);
                            }
                            setEditingNoteId(null);
                          }}
                          className="rounded-xl bg-blue-600 px-3 py-1 text-xs font-bold text-white shadow-xs hover:bg-blue-700"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                      {note.content}
                    </p>
                  )}
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
              No generic notes logged yet for this preplan.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

