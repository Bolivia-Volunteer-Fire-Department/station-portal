import React, { useState, useMemo, useRef } from 'react';
import {
  X,
  Calendar,
  User,
  Loader2,
  Lock,
  Unlock,
  Printer,
  Trash2,
  Save,
  Truck,
  Paperclip,
  FileUp,
  Eye,
  BadgeCheck,
  Stamp,
} from 'lucide-react';
import Markdown from '../Markdown';
import SignaturePad from '../forms/SignaturePad';
import MultiSelectDropdown from '../forms/MultiSelectDropdown';
import ConfirmModal from '../ConfirmModal';
import PrintableTaskNoteEntry from './PrintableTaskNoteEntry';
import {
  saveTaskNoteEntry,
  unsignTaskNoteEntry,
  deleteTaskNoteEntry,
} from '../../services/api';
import {
  TASK_NOTE_KINDS,
  TASK_NOTE_STATUS,
  KIND_META,
  STATUS_META,
} from '../../utils/tasksAndNotes';
import {
  formatPhoneNumber,
  parseSignatureValue,
  validateFormSubmission,
} from '../../utils/formDefinition';
import {
  uploadFormFile,
  openFormFile,
  discardFormFile,
  validateFormFile,
  formatFileSize,
} from '../../services/formFileStorage';
import { toast } from '../../utils/toast';
import { renderInViewport } from '../../utils/viewportLayer';

export default function TaskNoteEntryModal({
  entry = null, // existing entry or null
  template = null, // template object
  templates = [],
  currentUser = null,
  canEdit = true,
  canUnsign = false,
  canDelete = false,
  apparatusList = [],
  departmentName = '',
  departmentLogoUrl = '',
  onClose,
  onSaved,
  onDeleted,
}) {
  // Find effective template
  const resolvedTemplate = useMemo(() => {
    if (template) return template;
    if (entry?.template_id && templates.length > 0) {
      const found = templates.find((t) => t.id === entry.template_id);
      if (found) return found;
    }
    // Fallback template constructed from entry metadata
    return {
      id: entry?.template_id || '',
      name: entry?.template_name || entry?.title || 'Log Entry',
      kind: entry?.kind || TASK_NOTE_KINDS.TASK,
      layout: entry?.layout || [],
    };
  }, [template, entry, templates]);

  // Entry status
  const currentStatus = entry?.status === TASK_NOTE_STATUS.SIGNED ? TASK_NOTE_STATUS.SIGNED : TASK_NOTE_STATUS.EDITABLE;
  const isSigned = currentStatus === TASK_NOTE_STATUS.SIGNED;
  const isReadOnly = isSigned || !canEdit;

  // Metadata form state (Title and Date/Time are permanent and non-modifiable)
  const title =
    entry?.title || resolvedTemplate.name || (entry?.kind === TASK_NOTE_KINDS.NOTE ? 'Shift Note' : 'Daily Task');
  const entryDate = entry?.entry_date || new Date().toISOString().slice(0, 10);
  const entryTime =
    entry?.entry_time ||
    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const [apparatusId, setApparatusId] = useState(
    entry?.apparatus_id || resolvedTemplate.apparatus_id || ''
  );

  // Field answers state
  const [answers, setAnswers] = useState(() => {
    const initial = {};
    const layout = resolvedTemplate.layout || [];
    layout.forEach((item, index) => {
      const fieldId = item.data_name || `field_${index + 1}`;
      if (item.field_type !== 'markdown' && item.field_type !== 'divider' && fieldId) {
        if (entry?.data?.[fieldId] !== undefined) {
          const raw = entry.data[fieldId];
          if (item.field_type === 'file') {
            initial[fieldId] = Array.isArray(raw) ? raw : raw ? [raw] : [];
          } else {
            initial[fieldId] = raw;
          }
        } else if (item.field_type === 'multiselect') {
          initial[fieldId] = Array.isArray(item.default_value)
            ? item.default_value
            : item.default_value
            ? [item.default_value]
            : [];
        } else if (item.field_type === 'file') {
          initial[fieldId] = Array.isArray(item.default_value) ? item.default_value : [];
        } else if (item.field_type === 'checkbox') {
          initial[fieldId] = item.default_value !== undefined ? Boolean(item.default_value) : false;
        } else {
          initial[fieldId] = item.default_value !== undefined ? item.default_value : '';
        }
      }
    });
    return initial;
  });

  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [uploadingField, setUploadingField] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingUnsign, setPendingUnsign] = useState(false);
  const [signConfirmationOpen, setSignConfirmationOpen] = useState(false);
  const [printing, setPrinting] = useState(false);

  const printAreaRef = useRef(null);

  const kindMeta = KIND_META[resolvedTemplate.kind] || KIND_META[TASK_NOTE_KINDS.TASK];
  const statusMeta = STATUS_META[currentStatus] || STATUS_META[TASK_NOTE_STATUS.EDITABLE];

  const spanClass = (span) => {
    switch (span) {
      case 1:
        return 'col-span-1 md:col-span-1';
      case 2:
        return 'col-span-1 md:col-span-2';
      case 3:
      default:
        return 'col-span-1 md:col-span-3';
    }
  };

  const handleFieldChange = (dataName, val) => {
    if (isReadOnly) return;
    setAnswers((prev) => ({ ...prev, [dataName]: val }));
    if (errors[dataName]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[dataName];
        return next;
      });
    }
  };

  const handleAttemptSign = () => {
    const validation = validateFormSubmission(resolvedTemplate.layout || [], answers);
    if (!validation.valid) {
      setErrors(validation.errors);
      toast.error('Please complete all required fields before signing.');
      return;
    }
    setSignConfirmationOpen(true);
  };

  const handleFileUpload = async (fieldId, event) => {
    const rawFiles = Array.from(event.target.files || []);
    if (rawFiles.length === 0) return;

    for (const f of rawFiles) {
      const err = validateFormFile(f);
      if (err) {
        toast.error(err);
        event.target.value = '';
        return;
      }
    }

    setUploadingField(fieldId);
    try {
      const currentList = Array.isArray(answers[fieldId]) ? answers[fieldId] : [];
      const uploadedList = [...currentList];

      for (const f of rawFiles) {
        const fileRecord = await uploadFormFile(f, {
          formId: resolvedTemplate.id || 'tasks_and_notes',
          userId: currentUser?.id || 'unknown',
        });
        uploadedList.push(fileRecord);
      }

      handleFieldChange(fieldId, uploadedList);
      toast.success(
        rawFiles.length === 1 ? 'File uploaded.' : `${rawFiles.length} files uploaded.`
      );
    } catch (uploadErr) {
      toast.error(uploadErr.message || 'File upload failed.');
    } finally {
      setUploadingField(null);
      event.target.value = '';
    }
  };

  const handleFileRemove = async (fieldId, fileIndex) => {
    if (isReadOnly) return;
    const currentList = Array.isArray(answers[fieldId]) ? answers[fieldId] : [];
    const target = currentList[fileIndex];
    if (!target) return;

    try {
      await discardFormFile(target.storagePath);
    } catch {
      // Non-fatal if storage delete fails
    }

    const updated = currentList.filter((_, idx) => idx !== fileIndex);
    handleFieldChange(fieldId, updated);
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const apparatus = apparatusList.find((a) => a.id === apparatusId);
      const payload = {
        id: entry?.id || '',
        template_id: resolvedTemplate.id || '',
        template_name: resolvedTemplate.name || '',
        kind: resolvedTemplate.kind || TASK_NOTE_KINDS.TASK,
        title: title.trim() || resolvedTemplate.name,
        entry_date: entryDate,
        entry_time: entryTime,
        apparatus_id: apparatusId,
        apparatus_identifier: apparatus?.identifier || '',
        submitted_by_uid: entry?.submitted_by_uid || currentUser?.id || '',
        submitted_by_name:
          entry?.submitted_by_name || currentUser?.name || currentUser?.full_name || 'Member',
        submitted_by_rank:
          entry?.submitted_by_rank || currentUser?.rank_name || currentUser?.rank || '',
        status: TASK_NOTE_STATUS.EDITABLE,
        data: answers,
      };

      const result = await saveTaskNoteEntry(payload);
      toast.success('Saved draft successfully.');
      const saved = {
        ...payload,
        ...(result && typeof result === 'object' ? result : {}),
        id: result?.id || payload.id || entry?.id,
      };
      if (onSaved) onSaved(saved);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to save entry.');
    } finally {
      setSaving(false);
    }
  };

  const handleSignAndComplete = async () => {
    const validation = validateFormSubmission(resolvedTemplate.layout || [], answers);
    if (!validation.valid) {
      setErrors(validation.errors);
      toast.error('Please complete all required fields before finalizing.');
      setSignConfirmationOpen(false);
      return;
    }
    setSigning(true);
    try {
      const apparatus = apparatusList.find((a) => a.id === apparatusId);
      const signerName = currentUser?.name || currentUser?.full_name || 'Member';
      const signerRank = currentUser?.rank_name || currentUser?.rank || '';
      const signerUid = currentUser?.id || '';
      const nowTimestamp = new Date().toISOString();

      const payload = {
        id: entry?.id || '',
        template_id: resolvedTemplate.id || '',
        template_name: resolvedTemplate.name || '',
        kind: resolvedTemplate.kind || TASK_NOTE_KINDS.TASK,
        title: title.trim() || resolvedTemplate.name,
        entry_date: entryDate,
        entry_time: entryTime,
        apparatus_id: apparatusId,
        apparatus_identifier: apparatus?.identifier || '',
        submitted_by_uid: entry?.submitted_by_uid || currentUser?.id || '',
        submitted_by_name: entry?.submitted_by_name || signerName,
        submitted_by_rank: entry?.submitted_by_rank || signerRank,
        status: TASK_NOTE_STATUS.SIGNED,
        signed_by_uid: signerUid,
        signed_by_name: signerName,
        signed_by_rank: signerRank,
        signed_at: nowTimestamp,
        signature_data: {
          stamped: true,
          name: signerName,
          rank: signerRank,
          timestamp: nowTimestamp,
          method: 'electronic_stamp',
        },
        data: answers,
      };

      const result = await saveTaskNoteEntry(payload);
      toast.success('Entry finalized with electronic stamp.');
      setSignConfirmationOpen(false);
      const saved = {
        ...payload,
        ...(result && typeof result === 'object' ? result : {}),
        id: result?.id || payload.id || entry?.id,
      };
      if (onSaved) onSaved(saved);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to finalize entry.');
    } finally {
      setSigning(false);
    }
  };

  const handleUnsign = async () => {
    if (!entry?.id) return;
    try {
      const result = await unsignTaskNoteEntry(entry.id);
      toast.success('Entry un-signed and unlocked for editing.');
      setPendingUnsign(false);
      const saved = {
        ...entry,
        ...(result && typeof result === 'object' ? result : {}),
        status: TASK_NOTE_STATUS.EDITABLE,
        signed_by_uid: '',
        signed_by_name: '',
        signed_at: null,
        signature_data: null,
      };
      if (onSaved) onSaved(saved);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to un-sign entry.');
    }
  };

  const handleDelete = async () => {
    if (!entry?.id) return;
    setSaving(true);
    try {
      await deleteTaskNoteEntry(entry.id);
      toast.success('Entry deleted.');
      setPendingDelete(false);
      if (onDeleted) onDeleted(entry.id);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to delete entry.');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    setPrinting(true);
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto"
    >
      <div
        ref={printAreaRef}
        className="relative w-full max-w-5xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh] my-auto"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${kindMeta.badgeClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${kindMeta.dotClass}`} />
              {kindMeta.label}
            </span>

            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusMeta.badgeClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
              {statusMeta.label}
            </span>

            <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">
              {title || 'Untitled Entry'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
              title="Print Entry"
            >
              <Printer className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto p-6 space-y-6">
          {/* Signed Status Banner */}
          {isSigned && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-800/80 dark:bg-emerald-950/40">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                    <Lock className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 flex items-center gap-1.5">
                      <BadgeCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      Finalized &amp; Locked Record
                    </h4>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      Finalized with electronic stamp by{' '}
                      <strong>{entry?.signed_by_name || 'Member'}</strong>
                      {entry?.signed_by_rank ? ` (${entry.signed_by_rank})` : ''} on{' '}
                      {entry?.signed_at ? new Date(entry.signed_at).toLocaleString() : entryDate}.
                    </p>
                  </div>
                </div>

                {canUnsign && (
                  <button
                    type="button"
                    onClick={() => setPendingUnsign(true)}
                    className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-xs hover:bg-emerald-50 dark:border-emerald-700 dark:bg-slate-800 dark:text-emerald-300 dark:hover:bg-slate-700 transition"
                  >
                    <Unlock className="h-3.5 w-3.5 text-amber-500" />
                    <span>Un-sign & Unlock</span>
                  </button>
                )}
              </div>

              {/* Electronic Stamp Card */}
              <div className="mt-3 pt-3 border-t border-emerald-200/80 dark:border-emerald-800/60">
                {typeof entry?.signature_data === 'string' && entry.signature_data.startsWith('data:image/') ? (
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      Recorded Signature
                    </span>
                    <div className="mt-1 h-14 w-52 rounded-lg border border-emerald-200 bg-white p-1 dark:border-emerald-800 dark:bg-slate-900">
                      <img
                        src={entry.signature_data}
                        alt="Digital Signature"
                        className="h-full w-full object-contain"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-3 rounded-xl border border-emerald-300 dark:border-emerald-700/80 bg-white/90 dark:bg-slate-900/90 px-3.5 py-2 shadow-2xs">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 shrink-0">
                      <Stamp className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                        Electronic Signature Stamp
                      </div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        {entry?.signed_by_name || 'Member'}
                        {entry?.signed_by_rank ? ` (${entry.signed_by_rank})` : ''}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
                        {entry?.signed_at ? new Date(entry.signed_at).toLocaleString() : entryDate} &bull; StationSync Verified
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Entry Info Header Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40 text-xs">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Entry Title
              </span>
              <p className="mt-1 font-semibold text-slate-900 dark:text-white truncate">
                {title || resolvedTemplate.name || 'Log Entry'}
              </p>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Date & Time
              </span>
              <p className="mt-1 font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span>
                  {entryDate} {entryTime ? `at ${entryTime}` : ''}
                </span>
              </p>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Submitted By
              </span>
              <p className="mt-1 font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span>
                  {entry?.submitted_by_name || currentUser?.name || currentUser?.full_name || 'Member'}
                  {(entry?.submitted_by_rank || currentUser?.rank_name) && (
                    <span className="ml-1 text-slate-400 font-normal">
                      ({entry?.submitted_by_rank || currentUser?.rank_name})
                    </span>
                  )}
                </span>
              </p>
            </div>

            {resolvedTemplate.kind === TASK_NOTE_KINDS.APPARATUS_CHECKLIST && (
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Apparatus
                </span>
                {isReadOnly ? (
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span>
                      {entry?.apparatus_identifier
                        ? `${entry.apparatus_identifier} - `
                        : ''}
                      {apparatusList.find((a) => a.id === apparatusId)?.description ||
                        entry?.apparatus_id ||
                        'Unspecified'}
                    </span>
                  </p>
                ) : (
                  <select
                    value={apparatusId}
                    onChange={(e) => setApparatusId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">Select Apparatus…</option>
                    {apparatusList.map((app) => (
                      <option key={app.id} value={app.id}>
                        {app.identifier ? `${app.identifier} - ` : ''}
                        {app.description}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* Form Interactive Layout Fields */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(resolvedTemplate.layout || []).map((item, index) => {
              const fieldId = item.data_name || `field_${index + 1}`;
              const val = answers[fieldId] !== undefined ? answers[fieldId] : '';
              const isFieldModifiable = !isReadOnly && item.modifiable !== false;
              const err = errors[fieldId];

              const itemCaption = item.caption || item.label || item.title || '';
              const itemInstructions = item.instructions || item.helper_text || '';
              const itemPlaceholder = item.placeholder || '';
              const markdownContent = item.markdown_content || item.markdown_text || itemCaption || '';

              if (item.field_type === 'divider') {
                return (
                  <div key={item.id || fieldId} className={`${spanClass(item.col_span || 3)} pt-2 pb-1`}>
                    {itemCaption ? (
                      <div className="flex items-center gap-3">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 shrink-0">
                          {itemCaption}
                        </h4>
                        <div className="h-px w-full bg-slate-200 dark:bg-slate-700" />
                      </div>
                    ) : (
                      <hr className="border-t border-slate-200 dark:border-slate-700 my-1" />
                    )}
                  </div>
                );
              }

              if (item.field_type === 'markdown') {
                return (
                  <div
                    key={item.id || fieldId}
                    className={`${spanClass(item.col_span || 3)} rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-4 select-text`}
                  >
                    <Markdown markdown={markdownContent} />
                  </div>
                );
              }

              if (item.field_type === 'checkbox') {
                return (
                  <div key={item.id || fieldId} className={spanClass(item.col_span || 3)}>
                    <label
                      htmlFor={fieldId}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all select-none ${
                        val
                          ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      } ${isFieldModifiable ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'} ${
                        err ? 'border-red-400 dark:border-red-600' : ''
                      }`}
                    >
                      <input
                        id={fieldId}
                        type="checkbox"
                        checked={Boolean(val)}
                        disabled={!isFieldModifiable}
                        onChange={(e) => handleFieldChange(fieldId, e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 dark:bg-slate-800 dark:border-slate-600 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                          <span>{itemCaption || itemPlaceholder || 'Check to confirm'}</span>
                          {item.required && !isReadOnly && item.modifiable !== false && (
                            <span className="text-red-500 font-bold">*</span>
                          )}
                          {item.modifiable === false && !isReadOnly && (
                            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">(Fixed)</span>
                          )}
                        </div>
                        {itemInstructions && (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {itemInstructions}
                          </p>
                        )}
                        {err && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{err}</p>}
                      </div>
                    </label>
                  </div>
                );
              }

              return (
                <div
                  key={item.id || fieldId}
                  className={`${spanClass(item.col_span || 3)} rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-2`}
                >
                  <label
                    htmlFor={fieldId}
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {itemCaption}
                    {item.required && !isReadOnly && item.modifiable !== false && (
                      <span className="text-red-500 ml-1 font-bold">*</span>
                    )}
                    {item.modifiable === false && !isReadOnly && (
                      <span className="ml-1.5 text-[10px] font-medium text-slate-400 dark:text-slate-500">(Fixed)</span>
                    )}
                  </label>

                  {itemInstructions && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                      {itemInstructions}
                    </p>
                  )}

                  <div className="pt-1">
                    {/* Text Field */}
                    {item.field_type === 'text' && (
                      <input
                        id={fieldId}
                        type="text"
                        value={val}
                        disabled={!isFieldModifiable}
                        placeholder={itemPlaceholder}
                        onChange={(e) => handleFieldChange(fieldId, e.target.value)}
                        className={`h-10 w-full rounded-xl border px-3 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-600 disabled:dark:text-slate-400 disabled:cursor-not-allowed ${
                          err
                            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600 focus:ring-red-500'
                        }`}
                      />
                    )}

                    {/* Textarea Field */}
                    {item.field_type === 'textarea' && (
                      <textarea
                        id={fieldId}
                        rows={3}
                        value={val}
                        disabled={!isFieldModifiable}
                        placeholder={itemPlaceholder}
                        onChange={(e) => handleFieldChange(fieldId, e.target.value)}
                        className={`w-full rounded-xl border p-3 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-600 disabled:dark:text-slate-400 disabled:cursor-not-allowed ${
                          err
                            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600 focus:ring-red-500'
                        }`}
                      />
                    )}

                    {/* Number Field */}
                    {item.field_type === 'number' && (
                      <input
                        id={fieldId}
                        type="number"
                        value={val}
                        disabled={!isFieldModifiable}
                        placeholder={itemPlaceholder}
                        onChange={(e) => handleFieldChange(fieldId, e.target.value)}
                        className={`h-10 w-full sm:w-48 rounded-xl border px-3 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-600 disabled:dark:text-slate-400 disabled:cursor-not-allowed ${
                          err
                            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600 focus:ring-red-500'
                        }`}
                      />
                    )}

                    {/* Single Select / Dropdown */}
                    {item.field_type === 'select' && (
                      <select
                        id={fieldId}
                        value={val}
                        disabled={!isFieldModifiable}
                        onChange={(e) => handleFieldChange(fieldId, e.target.value)}
                        className={`h-10 w-full rounded-xl border px-3 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-600 disabled:dark:text-slate-400 disabled:cursor-not-allowed ${
                          err
                            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600 focus:ring-red-500'
                        }`}
                      >
                        <option value="">{itemPlaceholder || 'Choose an option…'}</option>
                        {(item.options || []).map((opt) => {
                          const optLabel = typeof opt === 'string' ? opt : opt.label || opt.value;
                          const optVal = typeof opt === 'string' ? opt : opt.value || opt.label;
                          return (
                            <option key={optVal} value={optVal}>
                              {optLabel}
                            </option>
                          );
                        })}
                      </select>
                    )}

                    {/* MultiSelect Dropdown */}
                    {item.field_type === 'multiselect' && (
                      <MultiSelectDropdown
                        id={fieldId}
                        options={item.options || []}
                        value={Array.isArray(val) ? val : val ? [val] : []}
                        disabled={!isFieldModifiable}
                        onChange={(newVals) => handleFieldChange(fieldId, newVals)}
                        placeholder={itemPlaceholder || 'Select one or more options…'}
                        error={Boolean(err)}
                      />
                    )}

                    {/* Radio Group */}
                    {item.field_type === 'radio' && (
                      <div className="space-y-2">
                        {(item.options || []).map((opt) => {
                          const optLabel = typeof opt === 'string' ? opt : opt.label || opt.value;
                          const optVal = typeof opt === 'string' ? opt : opt.value || opt.label;
                          return (
                            <label
                              key={optVal}
                              className={`flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300 ${
                                !isFieldModifiable ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                              }`}
                            >
                              <input
                                type="radio"
                                name={fieldId}
                                value={optVal}
                                checked={val === optVal}
                                disabled={!isFieldModifiable}
                                onChange={(e) => handleFieldChange(fieldId, e.target.value)}
                                className="accent-red-600 focus:ring-red-500 h-4 w-4"
                              />
                              <span>{optLabel}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* Date Field */}
                    {item.field_type === 'date' && (
                      <input
                        id={fieldId}
                        type="date"
                        value={val}
                        disabled={!isFieldModifiable}
                        onChange={(e) => handleFieldChange(fieldId, e.target.value)}
                        className={`h-10 w-full sm:w-56 rounded-xl border px-3 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-600 disabled:dark:text-slate-400 disabled:cursor-not-allowed ${
                          err
                            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600 focus:ring-red-500'
                        }`}
                      />
                    )}

                    {/* Time Field */}
                    {item.field_type === 'time' && (
                      <input
                        id={fieldId}
                        type="time"
                        value={val}
                        disabled={!isFieldModifiable}
                        onChange={(e) => handleFieldChange(fieldId, e.target.value)}
                        className={`h-10 w-full sm:w-44 rounded-xl border px-3 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-600 disabled:dark:text-slate-400 disabled:cursor-not-allowed ${
                          err
                            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600 focus:ring-red-500'
                        }`}
                      />
                    )}

                    {/* Phone / Tel Field */}
                    {(item.field_type === 'tel' || item.field_type === 'phone') && (
                      <input
                        id={fieldId}
                        type="tel"
                        value={val}
                        disabled={!isFieldModifiable}
                        placeholder={itemPlaceholder || '(555) 000-0000'}
                        onChange={(e) => handleFieldChange(fieldId, formatPhoneNumber(e.target.value))}
                        className={`h-10 w-full sm:w-56 rounded-xl border px-3 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-600 disabled:dark:text-slate-400 disabled:cursor-not-allowed ${
                          err
                            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600 focus:ring-red-500'
                        }`}
                      />
                    )}

                    {/* Digital Signature Field */}
                    {item.field_type === 'signature' && (() => {
                      const sig = parseSignatureValue(val);
                      return !isFieldModifiable ? (
                        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xs">
                          {sig.image ? (
                            <div className="space-y-1.5">
                              <img
                                src={sig.image}
                                alt={itemCaption || 'Signature'}
                                className="max-h-20 object-contain signature-invert-dark dark:invert"
                              />
                              {sig.readable_time && (
                                <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                                  <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
                                  <span>
                                    Signed: <strong className="text-slate-700 dark:text-slate-300">{sig.readable_time}</strong>
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 italic">No signature recorded</span>
                          )}
                        </div>
                      ) : (
                        <SignaturePad
                          value={sig.image || (typeof val === 'string' ? val : '')}
                          onChange={(sigData) => handleFieldChange(fieldId, sigData)}
                          error={Boolean(err)}
                        />
                      );
                    })()}

                    {/* Signature Stamp Field */}
                    {item.field_type === 'signature_stamp' && (
                      val && typeof val === 'object' && val.stamped ? (
                        <div className="rounded-xl border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/70 dark:bg-emerald-950/20 p-3.5 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 shrink-0">
                              <BadgeCheck className="h-6 w-6" />
                            </div>
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                                Digitally Stamped & Verified
                              </p>
                              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {val.name || currentUser?.name || 'Authorized Member'}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {val.readable_time || (val.timestamp ? new Date(val.timestamp).toLocaleString() : '')}
                              </p>
                            </div>
                          </div>
                          {isFieldModifiable && (
                            <button
                              type="button"
                              onClick={() => handleFieldChange(fieldId, null)}
                              className="text-xs text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 font-medium px-2.5 py-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      ) : !isFieldModifiable ? (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-400 italic bg-slate-50 dark:bg-slate-900/40">
                          No digital stamp applied
                        </div>
                      ) : (
                        <button
                          type="button"
                          id={fieldId}
                          onClick={() =>
                            handleFieldChange(fieldId, {
                              stamped: true,
                              name: currentUser?.name || currentUser?.full_name || 'Authorized Member',
                              email: currentUser?.email || '',
                              timestamp: new Date().toISOString(),
                              readable_time: new Date().toLocaleString(),
                            })
                          }
                          className={`w-full py-3 px-4 rounded-xl border border-dashed text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                            err
                              ? 'border-red-400 text-red-600 bg-red-50/50 hover:bg-red-100/50 dark:border-red-600 dark:text-red-400 dark:bg-red-950/20'
                              : 'border-blue-400 text-blue-700 dark:text-blue-300 bg-blue-50/50 hover:bg-blue-100/60 dark:border-blue-700 dark:bg-blue-950/30 dark:hover:bg-blue-900/40'
                          }`}
                        >
                          <BadgeCheck className="h-4 w-4" />
                          Click to Apply Digital Signature Stamp
                        </button>
                      )
                    )}

                    {/* File Upload Field */}
                    {item.field_type === 'file' && (
                      <div className="space-y-3">
                        {Array.isArray(val) && val.length > 0 && (
                          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                            {val.map((f, idx) => (
                              <div
                                key={f.storagePath || idx}
                                className="flex items-center justify-between p-2.5 text-xs"
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <Paperclip className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                                    {f.name}
                                  </span>
                                  {f.size && (
                                    <span className="text-[11px] text-slate-400">
                                      ({formatFileSize(f.size)})
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => openFormFile(f.storagePath)}
                                    className="p-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                                    title="View / Download file"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </button>
                                  {isFieldModifiable && (
                                    <button
                                      type="button"
                                      onClick={() => handleFileRemove(fieldId, idx)}
                                      className="p-1 text-rose-500 hover:text-rose-700"
                                      title="Remove file"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {isFieldModifiable && (
                          <div>
                            <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition">
                              {uploadingField === fieldId ? (
                                <Loader2 className="h-4 w-4 animate-spin text-red-500" />
                              ) : (
                                <FileUp className="h-4 w-4 text-slate-500" />
                              )}
                              <span>
                                {uploadingField === fieldId ? 'Uploading…' : 'Attach Files / Pictures (Max 25MB)'}
                              </span>
                              <input
                                type="file"
                                multiple
                                disabled={uploadingField === fieldId}
                                onChange={(e) => handleFileUpload(fieldId, e)}
                                className="sr-only"
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    )}

                    {err && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{err}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-800 shrink-0 bg-slate-50/60 dark:bg-slate-800/40 rounded-b-2xl">
          <div className="flex items-center gap-2">
            {canDelete && entry?.id && (
              <button
                type="button"
                onClick={() => setPendingDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40 transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Entry</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 transition"
            >
              Close
            </button>

            {!isSigned && canEdit && (
              <>
                <button
                  type="button"
                  disabled={saving || signing}
                  onClick={handleSaveDraft}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-2xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  <span>Save Draft</span>
                </button>

                <button
                  type="button"
                  disabled={saving || signing}
                  onClick={handleAttemptSign}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition disabled:opacity-60"
                  title="Finalize entry with electronic stamp"
                >
                  <Stamp className="h-4 w-4" />
                  <span>Finalize Entry</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Finalize with Electronic Stamp Confirmation Modal */}
      {signConfirmationOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <Stamp className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Finalize &amp; Stamp Entry
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Finalizing will apply an electronic stamp and lock this entry.
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              By finalizing below, you certify that this log entry is accurate and complete. An official electronic verification stamp will be applied under your name with an immutable timestamp.
            </p>

            {/* Electronic Stamp Preview Box */}
            <div className="rounded-xl border-2 border-dashed border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-950/30 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                  <Stamp className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-black uppercase tracking-widest text-emerald-800 dark:text-emerald-300">
                    Official Electronic Stamp
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {currentUser?.name || currentUser?.full_name || 'Member'}
                    {(currentUser?.rank_name || currentUser?.rank) && (
                      <span className="ml-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                        ({currentUser?.rank_name || currentUser?.rank})
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {new Date().toLocaleString()} &bull; StationSync Digital Certification
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setSignConfirmationOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={signing}
                onClick={handleSignAndComplete}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-60 transition"
              >
                {signing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stamp className="h-3.5 w-3.5" />}
                <span>Finalize &amp; Apply Stamp</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Un-sign Confirmation Modal */}
      {pendingUnsign && (
        <ConfirmModal
          title="Un-sign Entry"
          message="Are you sure you want to un-sign this entry? This will remove the electronic verification stamp and return the entry to editable draft state so changes can be made."
          confirmLabel="Remove Stamp & Unlock"
          tone="default"
          onConfirm={handleUnsign}
          onCancel={() => setPendingUnsign(false)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {pendingDelete && (
        <ConfirmModal
          title="Delete Entry"
          message={`Are you sure you want to permanently delete "${title}"? This action cannot be undone.`}
          confirmLabel="Delete"
          tone="danger"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(false)}
        />
      )}
    </div>
  );

  return (
    <>
      {renderInViewport(modalContent)}
      {printing && (
        <PrintableTaskNoteEntry
          entry={
            entry || {
              id: '',
              title,
              kind: resolvedTemplate.kind || TASK_NOTE_KINDS.TASK,
              status: isSigned ? TASK_NOTE_STATUS.SIGNED : TASK_NOTE_STATUS.EDITABLE,
              entry_date: entryDate,
              entry_time: entryTime,
              apparatus_id: apparatusId,
              submitted_by_name: currentUser?.name || 'Member',
              submitted_by_rank: currentUser?.rank || '',
              data: answers,
            }
          }
          template={resolvedTemplate}
          title={title}
          entryDate={entryDate}
          entryTime={entryTime}
          apparatusName={
            apparatusList.find((a) => String(a.id) === String(apparatusId))?.name ||
            apparatusList.find((a) => String(a.id) === String(apparatusId))?.unit_number ||
            ''
          }
          answers={answers}
          departmentName={departmentName}
          logoUrl={departmentLogoUrl}
          onDone={() => setPrinting(false)}
        />
      )}
    </>
  );
};

// Modal sound definition for verify-sounds.mjs

