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
  Users,
  Calendar,
  Clock,
  Sparkles,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import ViewportModal from '../ViewportModal.jsx';
import { prepareTrainingImportPlan } from '../../utils/trainingCsvImport.js';
import { adminBulkImportTrainings } from '../../services/api.js';

export default function AdminTrainingImportModal({
  isOpen,
  onClose,
  users = [],
  token,
  onImportSuccess,
}) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [manualMapping, setManualMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Sorted users for manual mapping dropdown
  const sortedUsers = useMemo(() => {
    return [...(users || [])].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    );
  }, [users]);

  // Compute import plan from raw CSV and user roster
  const plan = useMemo(() => {
    if (!csvText) return null;
    try {
      return prepareTrainingImportPlan(csvText, users, manualMapping);
    } catch (err) {
      console.error('Failed to prepare training import plan:', err);
      return null;
    }
  }, [csvText, users, manualMapping]);

  // Handle file load
  const processFile = (file) => {
    if (!file) return;
    setImportError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result;
      if (typeof content === 'string') {
        setCsvText(content);
        setManualMapping({});
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

  const handleManualMap = (attendeeName, targetUserId) => {
    setManualMapping((prev) => ({
      ...prev,
      [attendeeName]: targetUserId,
    }));
  };

  const handleReset = () => {
    setCsvText('');
    setFileName('');
    setManualMapping({});
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExecuteImport = async () => {
    if (!plan || !plan.sessions.length) return;

    setImporting(true);
    setImportError(null);

    try {
      const result = await adminBulkImportTrainings({ sessions: plan.sessions }, token);
      if (!result?.success) {
        throw new Error(result?.message || 'Failed to import training records.');
      }

      onImportSuccess?.({
        trainingsCreated: result.trainingsCreated ?? plan.sessions.length,
        signaturesCreated: result.signaturesCreated ?? plan.totalSignatures,
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
      title="Import Training CSV"
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

        {/* Step 1: Upload Dropzone if no CSV loaded */}
        {!csvText ? (
          <div className="space-y-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 ${
                isDragging
                  ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20'
                  : 'border-slate-300 dark:border-slate-700 hover:border-red-400 dark:hover:border-red-500/70 bg-slate-50/50 dark:bg-slate-800/40'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center justify-center shadow-inner">
                <Upload className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  Drop your training CSV file here, or{' '}
                  <span className="text-red-600 dark:text-red-400 underline">browse</span>
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Supports standard CSV exports from emergency services records systems
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
                Expected Column Headers
              </p>
              <p>Your CSV should contain the following headers (order and case insensitive):</p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 list-disc list-inside font-mono text-[11px] text-slate-700 dark:text-slate-300">
                <li>Attendee Full Name</li>
                <li>Activity/Training Category</li>
                <li>Activity/Training Total Hours</li>
                <li>Activity/Training Start Actual Date</li>
              </ul>
            </div>
          </div>
        ) : (
          /* Step 2: Inspection & Reconciliation View */
          <div className="space-y-5">
            {/* File info bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="w-5 h-5 text-red-600 shrink-0" />
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
                className="text-xs text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 underline font-medium"
              >
                Choose different file
              </button>
            </div>

            {/* Metric Summary Cards */}
            {plan && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Sessions
                  </span>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    {plan.sessions.length}
                  </div>
                  <span className="text-[11px] text-slate-500">Grouped trainings</span>
                </div>

                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" /> Signatures
                  </span>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    {plan.totalSignatures}
                  </div>
                  <span className="text-[11px] text-slate-500">Member attendances</span>
                </div>

                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Matched
                  </span>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {plan.matchedCount}
                  </div>
                  <span className="text-[11px] text-slate-500">Roster members</span>
                </div>

                <div
                  className={`p-3.5 border rounded-xl ${
                    plan.unmatchedAttendees.length > 0
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60'
                      : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <span
                    className={`text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                      plan.unmatchedAttendees.length > 0
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Unmatched
                  </span>
                  <div
                    className={`text-2xl font-bold mt-1 ${
                      plan.unmatchedAttendees.length > 0
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    {plan.unmatchedAttendees.length}
                  </div>
                  <span className="text-[11px] text-slate-500">Names to resolve</span>
                </div>
              </div>
            )}

            {/* Unmatched Members Mapping Section */}
            {plan && plan.unmatchedAttendees.length > 0 && (
              <div className="p-4 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl space-y-3">
                <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <p>
                    <span className="font-semibold">Unmatched Attendee Names:</span> We could not
                    automatically match these names to members on your active roster. You can
                    manually link each name to a member below, or leave it skipped.
                  </p>
                </div>

                <div className="divide-y divide-amber-200/60 dark:divide-amber-800/40 max-h-48 overflow-y-auto">
                  {plan.unmatchedAttendees.map((name) => (
                    <div
                      key={name}
                      className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        "{name}"
                      </span>
                      <select
                        value={manualMapping[name] || ''}
                        onChange={(e) => handleManualMap(name, e.target.value)}
                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-red-500 max-w-xs"
                      >
                        <option value="">-- Choose Member (or Skip) --</option>
                        <option value="__skip__">🚫 Skip this attendee</option>
                        <optgroup label="Active Roster Members">
                          {sortedUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Grouped Sessions Preview Table */}
            {plan && (
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <div className="p-3 bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                    Planned Training Sessions ({plan.sessions.length})
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Grouped by Date + Category + Hours
                  </span>
                </div>

                <div className="overflow-x-auto max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {(showAllSessions ? plan.sessions : plan.sessions.slice(0, 10)).map(
                    (session, idx) => (
                      <div
                        key={session.id || idx}
                        className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {session.title}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                              {session.duration} hr{session.duration === 1 ? '' : 's'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Date: <span className="font-mono">{session.date_key}</span> ·{' '}
                            {session.attendees.length} attendee(s)
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {session.attendees.map((a, aIdx) => (
                            <span
                              key={aIdx}
                              className={`px-1.5 py-0.5 rounded text-[10px] ${
                                a.user
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                              title={a.user ? `Matched to ${a.user.name}` : 'Unmatched'}
                            >
                              {a.attendeeName}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>

                {plan.sessions.length > 10 && (
                  <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700 text-center">
                    <button
                      type="button"
                      onClick={() => setShowAllSessions(!showAllSessions)}
                      className="text-xs text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 font-medium"
                    >
                      {showAllSessions
                        ? 'Show first 10 sessions'
                        : `Show all ${plan.sessions.length} sessions`}
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
            disabled={importing || plan.sessions.length === 0}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-xl shadow transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                Confirm & Import {plan.sessions.length} Sessions ({plan.totalSignatures} Signatures)
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
      </div>
    </ViewportModal>
  );
};

// Modal sound definition for verify-sounds.mjs

