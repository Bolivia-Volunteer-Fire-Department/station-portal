import React, { useState, useMemo, useRef } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Users,
  Award,
  Loader2,
  X,
  AlertCircle,
  Plus,
  Sparkles,
} from 'lucide-react';
import ViewportModal from '../ViewportModal';
import {
  parseCertificationTranscriptPdf,
  parseCertificationCsv,
  buildCertificationImportPlan,
} from '../../utils/certificationTranscriptImport';
import {
  adminSaveCertificationSetup,
  adminBulkSaveCertification,
} from '../../services/api';

export default function AdminCertificationImportModal({
  isOpen,
  onClose,
  users = [],
  setup = [],
  records = [],
  token,
  onImportComplete,
  onBadgesChanged,
}) {
  const [transcripts, setTranscripts] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [memberOverrides, setMemberOverrides] = useState({});
  const [certOverrides, setCertOverrides] = useState({});
  const [stripEditionOnCreate, setStripEditionOnCreate] = useState(true);
  const [skipExisting, setSkipExisting] = useState(true);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState(null);

  const fileInputRef = useRef(null);

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    );
  }, [users]);

  const sortedSetup = useMemo(() => {
    return [...setup].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    );
  }, [setup]);

  const plan = useMemo(() => {
    if (!transcripts.length) return null;
    return buildCertificationImportPlan({
      transcripts,
      users: sortedUsers,
      setup: sortedSetup,
      existingRecords: records,
      memberOverrides,
      certOverrides,
      stripEditionOnCreate,
      skipExisting,
    });
  }, [
    transcripts,
    sortedUsers,
    sortedSetup,
    records,
    memberOverrides,
    certOverrides,
    stripEditionOnCreate,
    skipExisting,
  ]);

  if (!isOpen) return null;

  const handleFilesSelected = async (e) => {
    const fileList = Array.from(e.target.files || []);
    if (!fileList.length) return;

    setError('');
    setImportResult(null);
    setParsing(true);

    try {
      const newlyParsed = [];
      for (const file of fileList) {
        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith('.csv')) {
          const csvText = await file.text();
          const parsedCsvList = parseCertificationCsv(csvText, file.name);
          newlyParsed.push(...parsedCsvList);
        } else {
          const buffer = await file.arrayBuffer();
          const parsedPdf = await parseCertificationTranscriptPdf(buffer, file.name);
          newlyParsed.push(parsedPdf);
        }
      }

      setTranscripts((prev) => [...prev, ...newlyParsed]);
    } catch (err) {
      setError(err?.message || 'Failed to read the selected file(s).');
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveTranscript = (indexToRemove) => {
    setTranscripts((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleReset = () => {
    setTranscripts([]);
    setMemberOverrides({});
    setCertOverrides({});
    setError('');
    setImportResult(null);
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleMemberOverrideChange = (memberKey, userId) => {
    setMemberOverrides((prev) => {
      const next = { ...prev };
      if (!userId) {
        delete next[memberKey];
      } else {
        next[memberKey] = userId;
      }
      return next;
    });
  };

  const handleCertOverrideChange = (rawTitle, value) => {
    setCertOverrides((prev) => {
      const next = { ...prev };
      if (!value) {
        delete next[rawTitle];
      } else {
        next[rawTitle] = value;
      }
      return next;
    });
  };

  const handleRunImport = async () => {
    if (!plan || plan.actionableItems.length === 0) return;

    setImporting(true);
    setError('');

    try {
      // 1. Create any new certification setup types first
      const createdTypeIdByName = new Map();
      // Pre-populate with existing setup names (case-insensitive)
      sortedSetup.forEach((t) => {
        if (t.name && t.id) {
          createdTypeIdByName.set(String(t.name).trim().toLowerCase(), String(t.id));
        }
      });

      let typesCreatedCount = 0;
      const newTypeNames = plan.typesToCreate || [];

      for (let i = 0; i < newTypeNames.length; i++) {
        const typeName = String(newTypeNames[i] || '').trim();
        const lowerKey = typeName.toLowerCase();
        if (!typeName || createdTypeIdByName.has(lowerKey)) continue;

        setProgress({
          phase: `Creating certification type (${i + 1} of ${newTypeNames.length}): ${typeName}`,
        });

        const res = await adminSaveCertificationSetup(
          {
            id: '',
            name: typeName,
            icon: 'award',
            description: 'Imported from Certification Transcript Summary',
            is_renewable: false,
            show_next_to_name: false,
            show_on_roster: true,
          },
          token
        );

        if (!res?.success || !res?.id) {
          throw new Error(
            res?.message ||
              `Could not create certification type "${typeName}". Make sure your role has Certification Setup permission or map it to an existing certification type.`
          );
        }

        createdTypeIdByName.set(lowerKey, String(res.id));
        typesCreatedCount++;
      }

      // 2. Build records to create and existing records to update
      const recordsToCreate = [];
      const recordsToUpdate = [];

      for (const item of plan.actionableItems) {
        if (!item.user?.id) continue;

        let certificationId = item.resolvedSetup?.id ? String(item.resolvedSetup.id) : '';
        if (!certificationId && item.action === '__create__') {
          const lookupKey = String(item.newTypeName || '').trim().toLowerCase();
          certificationId = createdTypeIdByName.get(lookupKey) || '';
        }

        if (!certificationId) continue;

        if (item.status === 'duplicate_update' && item.existingRecord?.id) {
          const updateEntry = { id: String(item.existingRecord.id) };
          if (item.effectiveDate) updateEntry.effective_date = item.effectiveDate;
          if (item.endDate) updateEntry.end_date = item.endDate;
          if (item.notes) updateEntry.notes = item.notes;
          recordsToUpdate.push(updateEntry);
        } else {
          recordsToCreate.push({
            id: '',
            user_id: String(item.user.id),
            certification_id: certificationId,
            effective_date: item.effectiveDate || '',
            end_date: item.endDate || '',
            notes: item.notes || '',
          });
        }
      }

      // 3. Save in batches of up to 400
      const CHUNK_SIZE = 400;
      let latestBadges = null;
      const totalOps = recordsToCreate.length + recordsToUpdate.length;

      setProgress({
        phase: `Saving ${totalOps} certification record${totalOps === 1 ? '' : 's'}...`,
      });

      for (let start = 0; start < Math.max(recordsToCreate.length, recordsToUpdate.length); start += CHUNK_SIZE) {
        const chunkRecords = recordsToCreate.slice(start, start + CHUNK_SIZE);
        const chunkUpdates = recordsToUpdate.slice(start, start + CHUNK_SIZE);
        if (!chunkRecords.length && !chunkUpdates.length) continue;

        const saveRes = await adminBulkSaveCertification(
          {
            records: chunkRecords,
            updates: chunkUpdates,
          },
          token
        );

        if (!saveRes?.success) {
          throw new Error(saveRes?.message || 'Failed to save imported certification records.');
        }

        if (saveRes.badges) {
          latestBadges = saveRes.badges;
        }
      }

      if (latestBadges) {
        onBadgesChanged?.(latestBadges);
      }

      setImportResult({
        recordsCreated: recordsToCreate.length,
        recordsUpdated: recordsToUpdate.length,
        typesCreated: typesCreatedCount,
      });

      onImportComplete?.({
        typesCreated: typesCreatedCount,
        recordsCreated: recordsToCreate.length,
        recordsUpdated: recordsToUpdate.length,
      });
    } catch (err) {
      setError(err?.message || 'An error occurred while importing certifications.');
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  return (
    <ViewportModal
      title="Import Certifications"
      subtitle="Import member certifications from NC OSFM Certification Transcript Summary PDFs or CSV files"
      icon={<Upload className="w-5 h-5" />}
      onClose={onClose}
      maxWidth="max-w-5xl"
      readOnly={true}
    >
      <div className="space-y-5">
        {/* Hidden file input supporting multiple PDFs or CSVs */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.csv,application/pdf,text/csv"
          multiple
          onChange={handleFilesSelected}
          className="hidden"
        />

        {/* Step 1: Dropzone when no files loaded yet */}
        {transcripts.length === 0 ? (
          <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 text-center bg-slate-50/60 dark:bg-slate-800/40">
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto mb-3">
              <FileText className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">
              Select Certification Transcript PDF(s) or CSV
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto mb-5 leading-relaxed">
              Upload one or more <strong>NC OSFM Certification Transcript Summary</strong> PDF files (or a CSV spreadsheet).
              The importer automatically extracts the member&apos;s name, certification titles, IFSAC numbers, and effective dates.
            </p>
            <button
              type="button"
              disabled={parsing}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold shadow-sm transition cursor-pointer disabled:opacity-50"
            >
              {parsing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Reading File(s)...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Choose PDF or CSV File(s)
                </>
              )}
            </button>
          </div>
        ) : (
          <>
            {/* File Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/70">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="w-5 h-5 text-red-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {transcripts.length === 1
                      ? transcripts[0].fileName
                      : `${transcripts.length} transcript files loaded`}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {plan?.counts.totalExtracted || 0} certification entries extracted
                  </p>
                </div>
              </div>
              {!importing && !importResult && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add More Files
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 px-2.5 py-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-300 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Import Completed Banner */}
            {importResult && (
              <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                <div>
                  <h4 className="text-base font-bold text-slate-900 dark:text-white">
                    Certifications Imported Successfully
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Added <strong>{importResult.recordsCreated}</strong> certification record
                    {importResult.recordsCreated === 1 ? '' : 's'}
                    {importResult.recordsUpdated > 0 && (
                      <>
                        , updated <strong>{importResult.recordsUpdated}</strong> existing record
                        {importResult.recordsUpdated === 1 ? '' : 's'}
                      </>
                    )}
                    {importResult.typesCreated > 0 && (
                      <>
                        , and created <strong>{importResult.typesCreated}</strong> new certification type
                        {importResult.typesCreated === 1 ? '' : 's'} in Certification Setup
                      </>
                    )}
                    .
                  </p>
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {/* Preview & Configuration */}
            {plan && !importResult && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <Users className="w-3.5 h-3.5 text-blue-500" />
                      <span>Transcripts</span>
                    </div>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                      {plan.transcripts.filter((t) => t.resolvedUser && !t.isMemberSkipped).length}
                      <span className="text-xs font-normal text-slate-500 ml-1">
                        / {plan.transcripts.length} matched
                      </span>
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Ready to Import</span>
                    </div>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                      {plan.counts.readyToImport}
                      <span className="text-xs font-normal text-slate-500 ml-1">
                        of {plan.counts.totalExtracted}
                      </span>
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                      <span>New Cert Types</span>
                    </div>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                      {plan.counts.newTypesCount}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <Award className="w-3.5 h-3.5 text-amber-500" />
                      <span>Already on File</span>
                    </div>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                      {plan.counts.duplicateSkippedCount}
                    </p>
                  </div>
                </div>

                {/* Member Assignment Section */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/70 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      1. Member Matching
                    </h5>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Verify the roster member for each uploaded transcript
                    </span>
                  </div>

                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {plan.transcripts.map((t, idx) => {
                      const currentVal =
                        memberOverrides[t.memberKey] !== undefined
                          ? memberOverrides[t.memberKey]
                          : t.autoMatchedUser?.id || '';
                      const isUnmatched = !t.resolvedUser && !t.isMemberSkipped;

                      return (
                        <div
                          key={t.memberKey}
                          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg border ${
                            isUnmatched
                              ? 'bg-amber-500/10 border-amber-500/40'
                              : 'bg-white dark:bg-slate-900/70 border-slate-200/80 dark:border-slate-700/60'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                {t.memberName || 'Member name not detected'}
                              </span>
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                {t.certifications.length} cert{t.certifications.length === 1 ? '' : 's'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              File: {t.fileName}
                              {t.createdDate ? ` • Transcript Created: ${t.createdDate}` : ''}
                            </p>
                            {t.error && (
                              <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                                {t.error}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <select
                              value={currentVal}
                              onChange={(e) =>
                                handleMemberOverrideChange(t.memberKey, e.target.value)
                              }
                              className="text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                            >
                              <option value="">-- Select Roster Member --</option>
                              <option value="__skip__">-- Skip This Transcript --</option>
                              {sortedUsers.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>

                            {plan.transcripts.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveTranscript(idx)}
                                title="Remove file"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Certification Type Mapping & Import Options */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/70 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      2. Certification Type Mapping & Options
                    </h5>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={stripEditionOnCreate}
                          onChange={(e) => setStripEditionOnCreate(e.target.checked)}
                          className="h-3.5 w-3.5 accent-red-600 rounded"
                        />
                        <span>Strip NFPA / edition suffix on new types</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={skipExisting}
                          onChange={(e) => setSkipExisting(e.target.checked)}
                          className="h-3.5 w-3.5 accent-red-600 rounded"
                        />
                        <span>Skip records already on file</span>
                      </label>
                    </div>
                  </div>

                  {plan.uniqueCertifications.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-900/60 divide-y divide-slate-200/70 dark:divide-slate-800">
                      {plan.uniqueCertifications.map((cert) => (
                        <div
                          key={cert.rawTitle}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 dark:text-white truncate">
                              {cert.rawTitle}
                            </p>
                            {cert.action === '__create__' && (
                              <p className="text-[11px] text-purple-600 dark:text-purple-400">
                                Will create in Certification Setup as: <strong>{cert.newTypeName}</strong>
                              </p>
                            )}
                          </div>
                          <select
                            value={cert.action}
                            onChange={(e) =>
                              handleCertOverrideChange(cert.rawTitle, e.target.value)
                            }
                            className="sm:w-72 shrink-0 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                          >
                            <option value="__create__">
                              + Create new type: &ldquo;{cert.newTypeName}&rdquo;
                            </option>
                            <option value="__skip__">-- Skip / Do not import --</option>
                            {sortedSetup.length > 0 && (
                              <optgroup label="Existing Certification Setup Types">
                                {sortedSetup.map((s) => (
                                  <option key={s.id} value={String(s.id)}>
                                    Match to: {s.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Extracted Certification Records Preview Table */}
                <div className="border border-slate-200 dark:border-slate-700/80 rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700/80 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      3. Extracted Certification Records ({plan.allItems.length})
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      IFSAC numbers are automatically saved to the record&apos;s Notes
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="py-2 px-3 font-semibold">Member</th>
                          <th className="py-2 px-3 font-semibold">Certification</th>
                          <th className="py-2 px-3 font-semibold">Effective Date</th>
                          <th className="py-2 px-3 font-semibold">Notes / IFSAC</th>
                          <th className="py-2 px-3 font-semibold text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800">
                        {plan.allItems.map((item) => {
                          const targetCertName = item.resolvedSetup
                            ? item.resolvedSetup.name
                            : item.action === '__create__'
                              ? item.newTypeName
                              : item.rawTitle;

                          return (
                            <tr
                              key={item.id}
                              className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                                item.status === 'skipped' || item.status === 'duplicate_skipped'
                                  ? 'opacity-55'
                                  : ''
                              }`}
                            >
                              <td className="py-2 px-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                                {item.user ? (
                                  item.user.name
                                ) : (
                                  <span className="text-amber-600 dark:text-amber-400">
                                    {item.memberName || 'Unmatched'}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-slate-800 dark:text-slate-200">
                                <div>{targetCertName}</div>
                                {targetCertName !== item.rawTitle && (
                                  <div className="text-[10px] text-slate-400 truncate max-w-xs">
                                    Transcript: {item.rawTitle}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {item.effectiveDate || '—'}
                              </td>
                              <td className="py-2 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {item.notes || '—'}
                              </td>
                              <td className="py-2 px-3 text-right whitespace-nowrap">
                                {item.status === 'ready' && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                    Ready
                                  </span>
                                )}
                                {item.status === 'create_type' && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400">
                                    New Type + Record
                                  </span>
                                )}
                                {item.status === 'duplicate_update' && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                    Update Existing
                                  </span>
                                )}
                                {item.status === 'duplicate_skipped' && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                    Already on File
                                  </span>
                                )}
                                {item.status === 'skipped' && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                                    Skipped
                                  </span>
                                )}
                                {item.status === 'unmatched_member' && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                    Select Member Above
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Progress Status */}
                {importing && progress && (
                  <div className="flex items-center gap-3 p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-300 text-xs">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>{progress.phase}</span>
                  </div>
                )}

                {/* Footer Actions */}
                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    disabled={importing}
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={importing || plan.counts.readyToImport === 0}
                    onClick={handleRunImport}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-sm transition cursor-pointer disabled:opacity-50"
                  >
                    {importing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Import {plan.counts.readyToImport} Certification
                        {plan.counts.readyToImport === 1 ? '' : 's'}
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </ViewportModal>
  );
}

