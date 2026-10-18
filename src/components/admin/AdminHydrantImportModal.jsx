import React, { useState, useMemo, useRef } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  X,
  ChevronDown,
  ChevronUp,
  Droplets,
  Calendar,
  Gauge,
  ArrowRight,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import ViewportModal from '../ViewportModal.jsx';
import { prepareHydrantImportPlan } from '../../utils/hydrantCsvImport.js';
import { adminBulkSaveHydrants } from '../../services/api.js';

export default function AdminHydrantImportModal({
  isOpen,
  onClose,
  existingHydrants = [],
  token,
  onImportSuccess,
}) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showAllHydrants, setShowAllHydrants] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Compute import plan from raw CSV and existing hydrants
  const plan = useMemo(() => {
    if (!csvText) return null;
    try {
      return prepareHydrantImportPlan(csvText, existingHydrants);
    } catch (err) {
      console.error('Failed to prepare hydrant import plan:', err);
      return null;
    }
  }, [csvText, existingHydrants]);

  const processFile = (file) => {
    if (!file) return;
    setImportError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result;
      if (typeof content === 'string') {
        setCsvText(content);
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read the selected file.');
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleReset = () => {
    setCsvText('');
    setFileName('');
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExecuteImport = async () => {
    if (!plan || !plan.hydrants.length) return;

    setImporting(true);
    setImportError(null);

    try {
      const result = await adminBulkSaveHydrants({ hydrants: plan.hydrants }, token);
      if (!result?.success) {
        throw new Error(result?.message || 'Failed to import hydrants.');
      }

      onImportSuccess?.({
        count: result.count ?? plan.hydrants.length,
        created: result.created ?? plan.newCount,
        updated: result.updated ?? plan.updateCount,
      });
      onClose();
    } catch (err) {
      setImportError(err.message || 'An error occurred during import.');
    } finally {
      setImporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ViewportModal
      isOpen={isOpen}
      onClose={importing ? () => {} : onClose}
      title="Import Hydrant Inspection & Flow Data"
      panelClassName="max-w-4xl max-h-[90vh] flex flex-col"
    >
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
        {importError && (
          <div className="p-3.5 rounded-xl bg-red-50 text-red-700 dark:bg-red-950/70 dark:text-red-300 border border-red-200 dark:border-red-800 text-sm flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
            <div>
              <p className="font-semibold">Import Error</p>
              <p>{importError}</p>
            </div>
          </div>
        )}

        {/* Upload Dropzone */}
        {!csvText ? (
          <div className="space-y-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 ${
                isDragging
                  ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
                  : 'border-slate-300 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500/70 bg-slate-50/50 dark:bg-slate-800/40'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-inner">
                <Upload className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  Drop your Hydrant CSV file here, or{' '}
                  <span className="text-blue-600 dark:text-blue-400 underline">browse</span>
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Supports municipal hydrant inspection exports with flow ratings and test pressures
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            <div className="bg-slate-100/70 dark:bg-slate-800/60 rounded-xl p-4 border border-slate-200/80 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-300 space-y-2">
              <p className="font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wider text-[11px]">
                Recognized Column Headers
              </p>
              <p>Your CSV can include the following headers (order and case insensitive):</p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 list-disc list-inside font-mono text-[11px] text-slate-700 dark:text-slate-300">
                <li>Hydrant ID</li>
                <li>Hydrant Location</li>
                <li>Hydrant Section Or District</li>
                <li>Hydrant Test Date</li>
                <li>Hydrant Test Static Pressure</li>
                <li>Hydrant Test Residual Pressure</li>
                <li>Hydrant Test Pitot Pressure</li>
                <li>Hydrant Test Calculated Gpm</li>
                <li>Hydrant Test Calculated Gpm At 20Psi</li>
                <li>Hydrant Test Tested By</li>
              </ul>
            </div>
          </div>
        ) : (
          /* Inspection & Reconciliation View */
          <div className="space-y-5">
            {/* File info bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                <span className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate">
                  {fileName}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                  ({plan?.totalRows || 0} rows)
                </span>
              </div>
              <button
                type="button"
                onClick={handleReset}
                disabled={importing}
                className="text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 underline font-medium"
              >
                Choose different file
              </button>
            </div>

            {/* Metric Summary Cards */}
            {plan && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Droplets className="w-3.5 h-3.5" /> Total Hydrants
                  </span>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    {plan.uniqueHydrantsCount}
                  </div>
                  <span className="text-[11px] text-slate-500">From {plan.validRowsCount} records</span>
                </div>

                <div className="p-3.5 bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> New Hydrants
                  </span>
                  <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                    {plan.newCount}
                  </div>
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-500">To create</span>
                </div>

                <div className="p-3.5 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-xl">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" /> Existing
                  </span>
                  <div className="text-2xl font-bold text-blue-700 dark:text-blue-400 mt-1">
                    {plan.updateCount}
                  </div>
                  <span className="text-[11px] text-blue-600 dark:text-blue-400">To update flow data</span>
                </div>

                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Gauge className="w-3.5 h-3.5" /> Rated Flows
                  </span>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    {plan.hydrants.filter((h) => h.flow).length}
                  </div>
                  <span className="text-[11px] text-slate-500">NFPA 291 ratings</span>
                </div>
              </div>
            )}

            {/* Hydrants Preview Table */}
            {plan && (
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <div className="p-3 bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                    Hydrant Preview ({plan.hydrants.length})
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Latest flow tests & ratings
                  </span>
                </div>

                <div className="overflow-x-auto max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {(showAllHydrants ? plan.hydrants : plan.hydrants.slice(0, 10)).map(
                    (h, idx) => (
                      <div
                        key={h.id || idx}
                        className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                              {h.id}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                h.nfpaClass?.badgeClass || 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {h.flow ? `${h.flow} GPM (${h.nfpaClass.shortClass})` : 'Unrated'}
                            </span>
                            {h.isExisting ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium">
                                Updates existing
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium">
                                New
                              </span>
                            )}
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 text-xs truncate">
                            {h.address || 'No address specified'}
                            {h.district ? ` · District/Sec ${h.district}` : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                          <div>
                            <span className="font-mono text-slate-700 dark:text-slate-300 font-semibold">
                              {h.static_pressure_psi ?? '—'} / {h.residual_pressure_psi ?? '—'}
                            </span>{' '}
                            PSI
                          </div>
                          {h.last_tested_date && (
                            <div>
                              Tested: <span className="font-mono">{h.last_tested_date}</span>
                              {h.tested_by ? ` (${h.tested_by})` : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>

                {plan.hydrants.length > 10 && (
                  <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700 text-center">
                    <button
                      type="button"
                      onClick={() => setShowAllHydrants(!showAllHydrants)}
                      className="text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
                    >
                      {showAllHydrants
                        ? 'Show first 10 hydrants'
                        : `Show all ${plan.hydrants.length} hydrants`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Skipped Rows Accordion */}
            {plan && plan.skippedRows.length > 0 && (
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setShowSkipped(!showSkipped)}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between text-left font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  <span className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-slate-400" />
                    Skipped Rows ({plan.skippedRows.length})
                  </span>
                  {showSkipped ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                {showSkipped && (
                  <div className="p-3 space-y-1.5 max-h-36 overflow-y-auto bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
                    {plan.skippedRows.map((item, idx) => (
                      <p key={idx} className="text-slate-500 dark:text-slate-400 text-[11px]">
                        Line {item.rowIndex}: {item.reason}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal Footer Actions */}
      <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={importing}
          className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 rounded-xl transition disabled:opacity-50"
        >
          Cancel
        </button>

        {plan && (
          <button
            type="button"
            onClick={handleExecuteImport}
            disabled={importing || plan.hydrants.length === 0}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                Confirm & Import {plan.hydrants.length} Hydrant{plan.hydrants.length === 1 ? '' : 's'}
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
      </div>
    </ViewportModal>
  );
}

