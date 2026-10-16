import React from 'react';
import {
  AlertTriangle,
  Building2,
  Compass,
  Droplets,
  Eye,
  FileText,
  Flame,
  MapPin,
  Paperclip,
  Phone,
  Printer,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { openPreplanFile } from '../services/preplanFileStorage';
import { formatFileSize } from '../utils/apparatus';

export default function PreIncidentPlanView({
  plan,
  stationName = '',
  onPrint,
  onNavigateToMap,
}) {
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

        {/* SECTION 3: Fire Protection Systems & Water Supply */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <h3 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold uppercase tracking-wider text-slate-900 dark:border-slate-700 dark:text-white">
            <Droplets className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            Fire Protection Systems & Water Supply
          </h3>
          <dl className="mt-3 divide-y divide-slate-100 text-xs dark:divide-slate-700/60">
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">FDC Locations</dt>
              <dd className="font-bold text-blue-700 dark:text-blue-300 text-right">{plan.fdc_locations || '—'}</dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Sprinkler Room Location</dt>
              <dd className="font-semibold text-slate-900 dark:text-white text-right">{plan.sprinkler_room_location || '—'}</dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Water Supply Information</dt>
              <dd className="font-medium text-slate-900 dark:text-white text-right">{plan.water_supply_info || '—'}</dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Needed Fire Flow</dt>
              <dd className="font-bold text-slate-900 dark:text-white">
                {plan.needed_fire_flow ? `${plan.needed_fire_flow.toLocaleString()} GPM` : '—'}
              </dd>
            </div>
          </dl>
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
                    <th className="py-1.5 font-semibold">ID / Tag</th>
                    <th className="py-1.5 font-semibold">Closest Address</th>
                    <th className="py-1.5 font-semibold">Distance</th>
                    <th className="py-1.5 font-semibold">Flow</th>
                    <th className="py-1.5 font-semibold">Status / Type</th>
                    <th className="py-1.5 font-semibold">Coordinates</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {plan.nearby_hydrants.map((h, i) => {
                    const hasCoords = Number.isFinite(h.latitude) && Number.isFinite(h.longitude);
                    return (
                      <tr key={h.id || i}>
                        <td className="py-2 font-mono font-medium text-slate-900 dark:text-white">{h.id || `#${i + 1}`}</td>
                        <td className="py-2 text-slate-600 dark:text-slate-300">
                          <div>{h.address || '—'}</div>
                          {h.notes ? <div className="text-[10px] italic text-slate-400">{h.notes}</div> : null}
                        </td>
                        <td className="py-2 text-slate-600 dark:text-slate-300">{h.distance || '—'}</td>
                        <td className="py-2 font-semibold text-blue-600 dark:text-blue-400">
                          {h.flow ? `${h.flow} gpm` : '—'}
                        </td>
                        <td className="py-2">
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
                        <td className="py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
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
    </div>
  );
}

