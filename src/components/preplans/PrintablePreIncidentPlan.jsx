import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { stationLogoUrl } from '../../utils/assets';
import { buildingLandmarkTypeFor } from '../../utils/buildingLandmarks';
import { INSPECTION_STATUSES, getPreplanInspectionDue } from '../../utils/preIncidentPlans';

export default function PrintablePreIncidentPlan({ plan, stationName = '', onDone }) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const finish = () => onDone?.();
    window.addEventListener('afterprint', finish);
    const timer = window.setTimeout(() => window.print(), 80);
    const safety = window.setTimeout(finish, 30000);
    return () => {
      window.removeEventListener('afterprint', finish);
      window.clearTimeout(timer);
      window.clearTimeout(safety);
    };
  }, [onDone]);

  if (!plan || typeof document === 'undefined') return null;

  const fullAddress = [
    plan.address1,
    plan.address2,
    plan.city,
    plan.state ? `${plan.state} ${plan.zip_code || ''}`.trim() : plan.zip_code,
  ]
    .filter(Boolean)
    .join(', ');

  const hasCoords = Number.isFinite(plan.latitude) && Number.isFinite(plan.longitude);
  const dueInfo = getPreplanInspectionDue(plan);

  return createPortal(
    <div className="print-sheet text-black text-xs font-sans leading-normal">
      {/* Header Block */}
      <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-4">
        <div className="flex items-center gap-3">
          <img src={stationLogoUrl()} alt="" className="h-14 w-14 object-contain" />
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-700">
              {plan.station || stationName || 'Fire Department'}
            </div>
            <div className="text-xl font-extrabold uppercase tracking-tight text-black">
              Pre-Incident Plan
            </div>
            <div className="text-base font-bold text-black">{plan.occupancy_name}</div>
          </div>
        </div>

        <div className="text-right text-xs">
          <div className="font-mono font-bold text-sm">OCC-ID: {plan.occupancy_id || '—'}</div>
          {hasCoords ? <div>GPS: {plan.latitude.toFixed(6)}, {plan.longitude.toFixed(6)}</div> : null}
          <div className="text-slate-600">Generated: {new Date().toLocaleString()}</div>
        </div>
      </div>

      {/* Critical Operational Banner */}
      <div className="grid grid-cols-6 gap-2 border border-black p-2 bg-slate-50 mb-4 text-[11px]">
        <div>
          <span className="block font-bold uppercase text-[9px] text-slate-600">Occupancy Type</span>
          <span className="font-bold text-black truncate block">{plan.occupancy_type || '—'}</span>
          <span className="text-[10px] text-slate-700 truncate block">{plan.property_use || '—'}</span>
        </div>
        <div>
          <span className="block font-bold uppercase text-[9px] text-slate-600">Construction</span>
          <span className="font-bold text-black truncate block">{plan.building_construction_type || '—'}</span>
          <span className="text-[10px] text-slate-700">{plan.year_built ? `Built ${plan.year_built}` : '—'}</span>
        </div>
        <div>
          <span className="block font-bold uppercase text-[9px] text-slate-600">Floors / Area</span>
          <span className="font-bold text-black">{plan.floors ? `${plan.floors} Fl.` : '—'}</span>
          <span className="text-[10px] text-slate-700 block">{plan.square_footage ? `${plan.square_footage.toLocaleString()} sqft` : '—'}</span>
        </div>
        <div>
          <span className="block font-bold uppercase text-[9px] text-slate-600">Needed Fire Flow</span>
          <span className="font-extrabold text-blue-900 text-xs">{plan.needed_fire_flow ? `${plan.needed_fire_flow.toLocaleString()} GPM` : '—'}</span>
          <span className="text-[9px] text-slate-600 block">Required GPM</span>
        </div>
        <div>
          <span className="block font-bold uppercase text-[9px] text-slate-600">Basement</span>
          <span className={`font-bold block ${plan.basement_present ? 'text-amber-900 underline' : 'text-slate-800'}`}>
            {plan.basement_present ? 'YES (Present)' : 'None'}
          </span>
        </div>
        <div>
          <span className="block font-bold uppercase text-[9px] text-slate-600">HazMat</span>
          <span className={`font-bold block truncate ${plan.hazmat ? 'text-red-900 underline' : 'text-slate-800'}`}>
            {plan.hazmat ? 'HAZMAT ON SITE' : 'None reported'}
          </span>
        </div>
      </div>

      {/* HazMat Callout */}
      {plan.hazmat ? (
        <div className="border-2 border-red-800 bg-red-50 p-2.5 mb-4 text-xs font-semibold text-red-950">
          <strong className="uppercase">⚠️ HazMat Warning: </strong> {plan.hazmat}
        </div>
      ) : null}

      {/* 2-Column Technical Layout */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Left Column: Occupancy Details */}
        <div className="border border-slate-400 p-2.5">
          <h3 className="font-bold uppercase text-xs border-b border-black pb-1 mb-2">
            Occupancy & Identification
          </h3>
          <table className="w-full text-xs">
            <tbody>
              <tr><td className="font-semibold text-slate-600 w-36 py-0.5">Address:</td><td className="font-medium text-black">{fullAddress || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Primary Phone:</td><td className="font-medium text-black">{plan.primary_phone || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Primary Email:</td><td className="font-medium text-black">{plan.primary_email || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Primary Fax:</td><td className="font-medium text-black">{plan.primary_fax || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">ISO ID / Utility:</td><td className="font-medium text-black">{plan.iso_id || '—'} / {plan.utility_billing_number || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">National Grid / APN:</td><td className="font-medium text-black">{plan.national_grid || '—'} / {plan.assessor_parcel_number || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Business License:</td><td className="font-medium text-black">{plan.business_license_number || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Assessed Value:</td><td className="font-medium text-black">{plan.assessed_value ? `$${plan.assessed_value.toLocaleString()}` : '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Inspector / Station / Zone:</td><td className="font-medium text-black">{plan.assigned_inspector || '—'} · {plan.station || '—'} · {plan.occupancy_zone || '—'}</td></tr>
              {plan.critical_infrastructure ? (
                <tr><td className="font-semibold text-slate-600 py-0.5">Critical Infra:</td><td className="font-bold text-red-900">{plan.critical_infrastructure}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Right Column: Prefire Plan & Building Info */}
        <div className="border border-slate-400 p-2.5">
          <h3 className="font-bold uppercase text-xs border-b border-black pb-1 mb-2">
            Building & Tactical Specifications
          </h3>
          <table className="w-full text-xs">
            <tbody>
              <tr><td className="font-semibold text-slate-600 w-36 py-0.5">Dimensions:</td><td className="font-medium text-black">{plan.building_length || '—'}′ L × {plan.building_width || '—'}′ W × {plan.building_height || '—'}′ H</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Roof Details:</td><td className="font-medium text-black">{[plan.roof_type, plan.roof_material, plan.roof_construction].filter(Boolean).join(' · ') || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Knox Box / Key:</td><td className="font-bold text-black">{plan.master_key_location || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">FACP Location:</td><td className="font-medium text-black">{plan.fire_alarm_panel_location || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Electrical Panel:</td><td className="font-medium text-black">{plan.electrical_panel_location || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Gas / LPG Shutoff:</td><td className="font-bold text-black">{plan.gas_lpg_shutoff_location || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Building Access:</td><td className="font-medium text-black">{plan.building_access || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Access Problems:</td><td className="font-medium text-black">{plan.access_problems || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Ventilation Issues:</td><td className="font-medium text-black">{plan.ventilation_problems || '—'}</td></tr>
              <tr><td className="font-semibold text-slate-600 py-0.5">Exposures:</td><td className="font-medium text-black">{plan.exposure_info || '—'}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Fire Protection Systems */}
      <div className="border border-slate-400 p-2.5 mb-4">
        <h3 className="font-bold uppercase text-xs border-b border-black pb-1 mb-2">
          Fire Protection Systems
        </h3>
        <table className="w-full text-xs">
          <tbody>
            <tr><td className="font-semibold text-slate-600 w-36 py-0.5">FDC Locations:</td><td className="font-bold text-blue-900">{plan.fdc_locations || '—'}</td></tr>
            <tr><td className="font-semibold text-slate-600 py-0.5">Sprinkler Room:</td><td className="font-medium text-black">{plan.sprinkler_room_location || '—'}</td></tr>
            <tr><td className="font-semibold text-slate-600 py-0.5">Water Supply Info:</td><td className="font-medium text-black">{plan.water_supply_info || '—'}</td></tr>
            <tr><td className="font-semibold text-slate-600 py-0.5">Needed Fire Flow:</td><td className="font-bold text-black">{plan.needed_fire_flow ? `${plan.needed_fire_flow.toLocaleString()} GPM` : '—'}</td></tr>
          </tbody>
        </table>
      </div>

      {/* Nearby Hydrants */}
      <div className="border border-slate-400 p-2.5 mb-4">
        <h3 className="font-bold uppercase text-xs border-b border-black pb-1 mb-2">
          Nearby Hydrants ({plan.nearby_hydrants?.length || 0})
        </h3>
        {plan.nearby_hydrants && plan.nearby_hydrants.length > 0 ? (
          <table className="w-full text-[11px] text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-300 font-bold">
                <th className="py-0.5 pr-2">ID</th>
                <th className="py-0.5 pr-2">Address</th>
                <th className="py-0.5 pr-2">Dist.</th>
                <th className="py-0.5 pr-2">Flow</th>
                <th className="py-0.5">Status</th>
              </tr>
            </thead>
            <tbody>
                {plan.nearby_hydrants.map((h, i) => {
                  const hasCoords = Number.isFinite(h.latitude) && Number.isFinite(h.longitude);
                  return (
                    <tr key={i} className="border-b border-slate-200">
                      <td className="font-bold py-0.5 pr-2">{h.id || `#${i+1}`}</td>
                      <td className="py-0.5 pr-2">
                        <div>{h.address || '—'}</div>
                        {hasCoords ? (
                          <div className="font-mono text-[9px] text-slate-500">
                            GPS: {h.latitude.toFixed(5)}, {h.longitude.toFixed(5)}
                          </div>
                        ) : null}
                        {h.notes ? <div className="text-[9px] italic text-slate-500">{h.notes}</div> : null}
                      </td>
                      <td className="py-0.5 pr-2">{h.distance || '—'}</td>
                      <td className="font-bold py-0.5 pr-2">{h.flow ? `${h.flow} gpm` : '—'}</td>
                      <td className="py-0.5 uppercase text-[9px] font-semibold">{h.status || 'in-service'} ({h.type || 'dry'})</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        ) : (
          <p className="italic text-slate-500 text-xs">No nearby hydrants listed.</p>
        )}
      </div>

      {/* Emergency Contacts & Chemical Inventory */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Emergency Contacts */}
        <div className="border border-slate-400 p-2.5">
          <h3 className="font-bold uppercase text-xs border-b border-black pb-1 mb-2">
            Emergency Contacts
          </h3>
          {plan.contacts && plan.contacts.length > 0 ? (
            <div className="space-y-1.5">
              {plan.contacts.map((c, i) => (
                <div key={i} className="border-b border-slate-200 pb-1 text-xs">
                  <div className="flex justify-between">
                    <span className="font-bold">{c.name}</span>
                    <span className="font-semibold text-slate-600">{c.description || 'Contact'}</span>
                  </div>
                  <div className="text-slate-700">Phone: {c.phone || '—'} {c.address ? `· Address: ${c.address}` : ''}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="italic text-slate-500 text-xs">No emergency contacts listed.</p>
          )}
        </div>

        {/* Chemical Inventory */}
        <div className="border border-slate-400 p-2.5">
          <h3 className="font-bold uppercase text-xs border-b border-black pb-1 mb-2">
            Chemical Inventory
          </h3>
          {plan.chemical_inventory ? (
            <pre className="font-mono text-[10px] whitespace-pre-wrap leading-tight text-slate-800">
              {plan.chemical_inventory}
            </pre>
          ) : (
            <p className="italic text-slate-500 text-xs">No hazardous chemicals recorded.</p>
          )}
        </div>
      </div>

      {/* Operational Notes */}
      {plan.prefire_plan_notes ? (
        <div className="border border-slate-400 p-2.5 mb-4">
          <h3 className="font-bold uppercase text-xs border-b border-black pb-1 mb-1">
            Tactical & Operational Notes
          </h3>
          <p className="text-xs text-slate-900 whitespace-pre-wrap">{plan.prefire_plan_notes}</p>
        </div>
      ) : null}

      {/* Plotted Building Landmarks & Tactical Features */}
      {plan.building_landmarks && plan.building_landmarks.length > 0 ? (
        <div className="border border-slate-400 p-2.5 mb-4">
          <h3 className="font-bold uppercase text-xs border-b border-black pb-1 mb-2">
            Plotted Building Landmarks & Tactical Features ({plan.building_landmarks.length})
          </h3>
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 text-left">
                <th className="py-1 px-1.5 font-bold">Feature / Type</th>
                <th className="py-1 px-1.5 font-bold">Label</th>
                <th className="py-1 px-1.5 font-bold">Side & Floor</th>
                <th className="py-1 px-1.5 font-bold">Coordinates</th>
                <th className="py-1 px-1.5 font-bold">Notes / Access Info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {plan.building_landmarks.map((lm, idx) => {
                const def = buildingLandmarkTypeFor(lm.type);
                return (
                  <tr key={lm.id || idx}>
                    <td className="py-1 px-1.5 font-semibold text-slate-900">
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                        style={{ background: def.color }}
                      />
                      {def.label}
                    </td>
                    <td className="py-1 px-1.5 font-medium">{lm.label || '—'}</td>
                    <td className="py-1 px-1.5 text-slate-700">{lm.side || '—'} &middot; {lm.floor || '—'}</td>
                    <td className="py-1 px-1.5 font-mono text-slate-600">
                      {Number.isFinite(lm.latitude) && Number.isFinite(lm.longitude)
                        ? `${Number(lm.latitude).toFixed(5)}, ${Number(lm.longitude).toFixed(5)}`
                        : '—'}
                    </td>
                    <td className="py-1 px-1.5 text-slate-800">{lm.notes || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Attached Diagrams & Tactical Files */}
      {plan.files && plan.files.length > 0 ? (
        <div className="border border-slate-400 p-2.5 mb-4">
          <h3 className="font-bold uppercase text-xs border-b border-black pb-1 mb-2">
            Attached Diagrams & Tactical Documents ({plan.files.length})
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {plan.files.map((f, i) => {
              const isImg =
                f.contentType?.startsWith('image/') ||
                f.type?.startsWith('image/') ||
                /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name || '');
              const src = f.dataUrl || f.downloadUrl;
              return (
                <div key={i} className="border border-slate-300 p-2 rounded text-[10px] bg-white">
                  <div className="font-bold truncate mb-1">{f.name || 'Attached Diagram'}</div>
                  {isImg && src ? (
                    <div className="text-center bg-slate-50 p-1 rounded border border-slate-200">
                      <img
                        src={src}
                        alt={f.name || 'Diagram'}
                        className="max-h-48 max-w-full mx-auto object-contain"
                      />
                    </div>
                  ) : (
                    <div className="text-slate-500 italic">Document file: {f.name}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Annual Site Inspections Running Log */}
      {plan.site_inspections && plan.site_inspections.length > 0 ? (
        <div className="border border-slate-400 p-2.5 mb-4">
          <div className="flex items-center justify-between border-b border-black pb-1 mb-2">
            <h3 className="font-bold uppercase text-xs">
              Annual Site Inspections Log ({plan.site_inspections.length})
            </h3>
            <span className="text-[10px] font-semibold text-slate-700">
              Next Annual Inspection Due: <strong>{dueInfo.nextDueDateString}</strong>{' '}
              {dueInfo.isOverdue ? '(OVERDUE)' : dueInfo.daysRemaining <= 30 ? '(Due Soon)' : '(Current)'}
            </span>
          </div>
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 text-left">
                <th className="py-1 px-1.5 font-bold">Inspection Date</th>
                <th className="py-1 px-1.5 font-bold">Inspector</th>
                <th className="py-1 px-1.5 font-bold">Result / Status</th>
                <th className="py-1 px-1.5 font-bold">Next Due (+365d)</th>
                <th className="py-1 px-1.5 font-bold">Notes / Findings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {plan.site_inspections.map((insp, idx) => {
                const statusObj = INSPECTION_STATUSES.find((s) => s.value === insp.status);
                let nextDue = '—';
                if (insp.inspection_date) {
                  const d = new Date(insp.inspection_date);
                  const nextD = new Date(d.getTime() + 365 * 24 * 60 * 60 * 1000);
                  nextDue = nextD.toISOString().split('T')[0];
                }
                return (
                  <tr key={insp.id || idx}>
                    <td className="py-1 px-1.5 font-semibold text-slate-900">{insp.inspection_date || '—'}</td>
                    <td className="py-1 px-1.5 font-medium">{insp.inspector_name || '—'}</td>
                    <td className="py-1 px-1.5 font-semibold">{statusObj?.label || insp.status || 'Passed'}</td>
                    <td className="py-1 px-1.5 font-mono text-slate-700">{nextDue}</td>
                    <td className="py-1 px-1.5 text-slate-800">{insp.notes || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Operational & Field Notes Log */}
      {plan.notes && plan.notes.length > 0 ? (
        <div className="border border-slate-400 p-2.5">
          <h3 className="font-bold uppercase text-xs border-b border-black pb-1 mb-2">
            Operational & Field Notes Log ({plan.notes.length})
          </h3>
          <div className="space-y-2">
            {plan.notes.map((note, idx) => (
              <div key={note.id || idx} className="border-b border-slate-200 pb-1.5 last:border-b-0 text-[10px]">
                <div className="flex items-center justify-between text-slate-600 mb-0.5">
                  <span className="font-bold text-slate-900">{note.author_name || 'Crew Member'}</span>
                  <span className="font-mono text-[9px]">
                    {note.created_at ? new Date(note.created_at).toLocaleString() : ''}
                  </span>
                </div>
                <div className="text-slate-800 whitespace-pre-wrap">{note.content}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>,
    document.body
  );
}
