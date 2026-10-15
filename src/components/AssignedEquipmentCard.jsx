import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  Radio,
  HardHat,
  ChevronDown,
  ChevronUp,
  Tag,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
} from 'lucide-react';
import { fetchEquipment, fetchAssetTypes } from '../services/api';
import {
  TURNOUT_GEAR_TYPES,
  RADIO_TYPES,
  evaluateTurnoutRetirement,
  evaluateInspectionCycle,
  conditionBadgeStyle,
} from '../utils/equipment';

export default function AssignedEquipmentCard({ currentUser, token, collapsible = true, defaultCollapsed = false }) {
  const [equipment, setEquipment] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const memberId = String(currentUser?.id || '').trim();

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!memberId) return;
      setLoading(true);
      try {
        const [response, typesRes] = await Promise.all([
          fetchEquipment(token),
          fetchAssetTypes(token).catch(() => null),
        ]);
        if (active && response?.equipment) {
          const myGear = response.equipment.filter((item) => String(item.assigned_to) === memberId);
          setEquipment(myGear);
        }
        if (active && typesRes?.assetTypes) {
          setAssetTypes(typesRes.assetTypes);
        }
      } catch (err) {
        console.warn('Failed to load member equipment:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [memberId, token]);

  const dynamicTurnoutTypes = useMemo(() => {
    const custom = assetTypes.filter((t) => t.category === 'turnout_gear');
    if (custom.length > 0) {
      return custom.map((t) => ({ id: t.value || t.id, label: t.label }));
    }
    return TURNOUT_GEAR_TYPES;
  }, [assetTypes]);

  const dynamicRadioTypes = useMemo(() => {
    const custom = assetTypes.filter((t) => t.category === 'radios');
    if (custom.length > 0) {
      return custom.map((t) => ({ id: t.value || t.id, label: t.label }));
    }
    return RADIO_TYPES;
  }, [assetTypes]);

  const turnoutGear = equipment.filter((e) => e.category === 'turnout_gear');
  const radios = equipment.filter((e) => e.category === 'radios');
  const totalCount = equipment.length;

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <button
        type="button"
        onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
        className={`w-full flex items-center justify-between p-6 ${
          !collapsed ? 'border-b border-slate-200 dark:border-slate-700' : ''
        } text-left transition ${collapsible ? 'hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer' : ''}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Assigned Gear & Equipment
              </h2>
              <span className="rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                {totalCount} {totalCount === 1 ? 'item' : 'items'}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400 truncate">
              Personal protective equipment (PPE) and radios assigned to you.
            </p>
          </div>
        </div>

        {collapsible && (
          <ChevronDown
            className={`w-5 h-5 text-slate-400 shrink-0 transition-transform duration-200 ${
              !collapsed ? 'rotate-180' : ''
            }`}
          />
        )}
      </button>

      {!collapsed && (
        <div className="p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-red-600" />
              <span className="ml-2.5 text-sm font-medium">Loading your equipment…</span>
            </div>
          ) : totalCount === 0 ? (
            <div className="py-8 text-center text-slate-500 dark:text-slate-400">
              <HardHat className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">No equipment currently assigned</p>
              <p className="text-xs text-slate-400 mt-1">
                When officers assign turnout gear or radios to your account, they will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Turnout Gear Section */}
              {turnoutGear.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <ShieldAlert className="h-4 w-4 text-red-500" />
                    <span>Turnout Gear (PPE)</span>
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {turnoutGear.map((item) => {
                      const typeLabel = dynamicTurnoutTypes.find((t) => t.id === item.type)?.label || item.type;
                      const retirement = evaluateTurnoutRetirement(item.manufacture_date);
                      const inspection = evaluateInspectionCycle(item.last_inspection_date);

                      return (
                        <div
                          key={item.id}
                          className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700/80 dark:bg-slate-900/60 transition"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                {typeLabel}
                              </div>
                              <div className="font-mono text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                SN: {item.serial_number} {item.size && `• Size: ${item.size}`}
                              </div>
                              {item.make_model && (
                                <div className="text-xs text-slate-400 mt-0.5">{item.make_model}</div>
                              )}
                            </div>
                            <span
                              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${conditionBadgeStyle(
                                item.condition
                              )}`}
                            >
                              {item.condition === 'in_service' ? 'In Service' : item.condition}
                            </span>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                            <span
                              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${retirement.badgeClass}`}
                            >
                              {retirement.label}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${inspection.badgeClass}`}
                            >
                              {inspection.label}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Radios Section */}
              {radios.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <Radio className="h-4 w-4 text-blue-500" />
                    <span>Assigned Radios</span>
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {radios.map((item) => {
                      const typeLabel = dynamicRadioTypes.find((t) => t.id === item.type)?.label || 'Radio';

                      return (
                        <div
                          key={item.id}
                          className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700/80 dark:bg-slate-900/60 transition"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                {item.identifier || typeLabel}
                              </div>
                              <div className="font-mono text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                SN: {item.serial_number}
                              </div>
                              {item.make_model && (
                                <div className="text-xs text-slate-400 mt-0.5">{item.make_model}</div>
                              )}
                            </div>
                            <span
                              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${conditionBadgeStyle(
                                item.condition
                              )}`}
                            >
                              {item.condition === 'in_service' ? 'In Service' : item.condition}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

