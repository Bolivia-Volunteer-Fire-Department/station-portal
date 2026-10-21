import React, { useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Calendar,
  CheckCircle2,
  Eye,
  FileEdit,
  FileUp,
  Loader2,
  Lock,
  Paperclip,
  Printer,
  Send,
  X,
} from 'lucide-react';
import Markdown from '../Markdown';
import SignaturePad from './SignaturePad';
import MultiSelectDropdown from './MultiSelectDropdown';
import PrintableFormSubmission from './PrintableFormSubmission';
import { formatPhoneNumber, parseSignatureValue, validateFormSubmission } from '../../utils/formDefinition';
import {
  uploadFormFile,
  openFormFile,
  discardFormFile,
  validateFormFile,
  formatFileSize,
} from '../../services/formFileStorage';
import { submitFormResponse } from '../../services/api';
import { toast } from '../../utils/toast';
import { renderInViewport } from '../../utils/viewportLayer';

export default function EnteredFormModal({
  form,
  currentUser,
  submission = null,
  isReadOnly: propIsReadOnly = false,
  departmentName = '',
  onClose,
  onSubmitted,
}) {
  const isReadOnly = Boolean(propIsReadOnly || submission?.locked);
  const [answers, setAnswers] = useState(() => {
    const initial = {};
    (form.layout || []).forEach((item) => {
      if (item.field_type !== 'markdown' && item.data_name) {
        if (submission?.data?.[item.data_name] !== undefined) {
          const raw = submission.data[item.data_name];
          if (item.field_type === 'file') {
            initial[item.data_name] = Array.isArray(raw) ? raw : (raw ? [raw] : []);
          } else {
            initial[item.data_name] = raw;
          }
        } else if (item.field_type === 'multiselect') {
          initial[item.data_name] = Array.isArray(item.default_value)
            ? item.default_value
            : item.default_value
            ? [item.default_value]
            : [];
        } else if (item.field_type === 'file') {
          initial[item.data_name] = Array.isArray(item.default_value) ? item.default_value : [];
        } else {
          initial[item.data_name] = item.default_value !== undefined ? item.default_value : '';
        }
      }
    });
    return initial;
  });

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [uploadingField, setUploadingField] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleFieldChange = (dataName, value) => {
    if (isReadOnly) return;
    const fieldItem = (form.layout || []).find((f) => f.data_name === dataName);
    if (fieldItem && fieldItem.modifiable === false) return;
    setAnswers((prev) => ({ ...prev, [dataName]: value }));
    if (errors[dataName]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[dataName];
        return next;
      });
    }
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
    setUploadProgress(0);

    const formId = form.id || submission?.form_template_id || 'general';
    try {
      const uploaded = [];
      for (let i = 0; i < rawFiles.length; i++) {
        const res = await uploadFormFile({
          formId,
          file: rawFiles[i],
          onProgress: (p) => setUploadProgress(Math.round(((i + p) / rawFiles.length) * 100)),
        });
        uploaded.push(res);
      }
      const currentList = Array.isArray(answers[fieldId]) ? answers[fieldId] : [];
      handleFieldChange(fieldId, [...currentList, ...uploaded]);
    } catch (err) {
      console.error('File upload error:', err);
      toast.error('Could not upload file: ' + (err?.message || 'Upload failed'));
    } finally {
      setUploadingField(null);
      setUploadProgress(0);
      event.target.value = '';
    }
  };

  const handleRemoveFile = (fieldId, fileIndex) => {
    if (isReadOnly) return;
    const currentList = Array.isArray(answers[fieldId]) ? answers[fieldId] : [];
    const removedFile = currentList[fileIndex];
    if (removedFile) {
      discardFormFile(removedFile);
    }
    const nextList = currentList.filter((_, i) => i !== fileIndex);
    handleFieldChange(fieldId, nextList);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isReadOnly) return;
    setGeneralError('');

    const validation = validateFormSubmission(form.layout || [], answers);
    if (!validation.valid) {
      setErrors(validation.errors);
      setGeneralError('Please correct the highlighted fields before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      await submitFormResponse({
        id: submission?.id || undefined,
        formTemplateId: form.id,
        formTemplateName: form.name,
        data: validation.data,
        submittedByUid: currentUser?.id,
        submittedByName: currentUser?.name || 'Member',
      });
      setSubmitted(true);
      toast.success(submission?.id ? 'Submission updated successfully!' : 'Form submitted successfully!');
      onSubmitted?.();
    } catch (err) {
      setGeneralError(err?.message || 'Could not submit this form. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

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

  return renderInViewport(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="entered-form-title"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <FileEdit className="h-5 w-5" />
            </div>
            <div>
              <h2 id="entered-form-title" className="text-base font-bold text-slate-900 dark:text-white">
                {form.name}
              </h2>
              {form.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400">{form.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPrinting(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              title="Print form"
            >
              <Printer className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <span>Print</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        {submitted ? (
          <div className="p-8 text-center space-y-4 my-auto">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {submission?.id ? 'Submission Updated!' : 'Form Submitted!'}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {submission?.id
                ? 'Your updated responses have been safely saved to your record.'
                : 'Your response has been recorded and safely stored with your member record.'}
            </p>
            <div className="pt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setIsPrinting(true)}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                <Printer className="h-4 w-4" />
                Print Submission
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-10 px-6 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold hover:bg-slate-800 dark:hover:bg-slate-100 transition shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
            {generalError && (
              <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" /> {generalError}
              </div>
            )}

            {submission?.locked ? (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 p-3.5 flex items-center gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                <Lock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  This form submission was locked by an administrator{submission.locked_by_name ? ` (${submission.locked_by_name}${submission.locked_readable_time ? ` on ${submission.locked_readable_time}` : ''})` : ''}. Further edits are disabled. You are viewing saved responses in read-only mode.
                </span>
              </div>
            ) : isReadOnly ? (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 p-3.5 flex items-center gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  This form has already been submitted and is locked for editing. You are viewing your saved responses.
                </span>
              </div>
            ) : submission?.id ? (
              <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 flex items-center justify-between text-xs text-blue-900 dark:text-blue-200">
                <span>
                  Editing previous submission from{' '}
                  <strong>
                    {submission.submitted_at
                      ? new Date(submission.submitted_at).toLocaleDateString()
                      : submission.date_key || 'earlier'}
                  </strong>
                </span>
                <span className="font-semibold text-blue-600 dark:text-blue-400">Update Mode</span>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-4 py-2.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  Submitting as: <strong className="text-slate-900 dark:text-white">{currentUser?.name || 'Current Member'}</strong>
                </span>
                <span>
                  Date: <strong className="text-slate-900 dark:text-white">{new Date().toLocaleDateString()}</strong>
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {(form.layout || []).map((item, idx) => {
                if (item.field_type === 'markdown') {
                  return (
                    <div
                      key={item.id || idx}
                      className={`${spanClass(item.col_span || 3)} rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30 p-4 select-text`}
                    >
                      <Markdown markdown={item.markdown_content || ''} />
                    </div>
                  );
                }

                if (item.field_type === 'divider') {
                  return (
                    <div
                      key={item.id || idx}
                      className={`${spanClass(item.col_span || 3)} pt-2 pb-1`}
                    >
                      {item.caption ? (
                        <div className="flex items-center gap-3">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 shrink-0">
                            {item.caption}
                          </h4>
                          <div className="h-px w-full bg-slate-200 dark:bg-slate-700" />
                        </div>
                      ) : (
                        <hr className="border-t border-slate-200 dark:border-slate-700 my-1" />
                      )}
                    </div>
                  );
                }

                const fieldId = item.data_name || `field_${idx}`;
                const val = answers[fieldId] ?? '';
                const err = errors[fieldId];
                const isFieldDisabled = isReadOnly || item.modifiable === false;

                return (
                  <div key={item.id || idx} className={`${spanClass(item.col_span || 3)} space-y-1.5`}>
                    <label
                      htmlFor={fieldId}
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      {item.caption}
                      {item.required && !isReadOnly && item.modifiable !== false && <span className="text-red-500 ml-1 font-bold">*</span>}
                      {item.modifiable === false && !isReadOnly && (
                        <span className="ml-1.5 text-[10px] font-medium text-slate-400 dark:text-slate-500">(Fixed)</span>
                      )}
                    </label>

                    {item.instructions && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                        {item.instructions}
                      </p>
                    )}

                    {item.field_type === 'textarea' ? (
                      <textarea
                        id={fieldId}
                        value={val}
                        disabled={isFieldDisabled}
                        onChange={(e) => handleFieldChange(fieldId, e.target.value)}
                        placeholder={item.placeholder}
                        rows={3}
                        className={`w-full rounded-xl border px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-600 disabled:dark:text-slate-400 disabled:cursor-not-allowed ${
                          err
                            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600 focus:ring-blue-500'
                        }`}
                      />
                    ) : item.field_type === 'tel' ? (
                      <input
                        id={fieldId}
                        type="tel"
                        value={val}
                        disabled={isFieldDisabled}
                        onChange={(e) => handleFieldChange(fieldId, formatPhoneNumber(e.target.value))}
                        placeholder={item.placeholder || '(555) 000-0000'}
                        className={`w-full h-10 rounded-xl border px-3 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-600 disabled:dark:text-slate-400 disabled:cursor-not-allowed ${
                          err
                            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600 focus:ring-blue-500'
                        }`}
                      />
                    ) : item.field_type === 'signature' ? (
                      (() => {
                        const sig = parseSignatureValue(val);
                        return isFieldDisabled ? (
                          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
                            {sig.image ? (
                              <div className="space-y-1.5">
                                <img
                                  src={sig.image}
                                  alt={item.caption || 'Signature'}
                                  className="max-h-20 object-contain signature-invert-dark dark:invert print:filter-none"
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
                            value={val}
                            onChange={(sigData) => handleFieldChange(fieldId, sigData)}
                            error={Boolean(err)}
                          />
                        );
                      })()
                    ) : item.field_type === 'signature_stamp' ? (
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
                          {!isFieldDisabled && (
                            <button
                              type="button"
                              onClick={() => handleFieldChange(fieldId, null)}
                              className="text-xs text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 font-medium px-2.5 py-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      ) : isFieldDisabled ? (
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
                              name: currentUser?.name || 'Authorized Member',
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
                    ) : item.field_type === 'file' ? (
                      <div className="space-y-2">
                        {/* Uploaded files list */}
                        {Array.isArray(val) && val.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {val.map((f, fIdx) => (
                              <div
                                key={f.fileId || fIdx}
                                className="flex items-center justify-between p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-xs"
                              >
                                <div className="flex items-center gap-2 truncate min-w-0">
                                  <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <div className="truncate">
                                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">
                                      {f.name}
                                    </p>
                                    {f.size ? (
                                      <p className="text-[10px] text-slate-400">
                                        {formatFileSize(f.size)}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 ml-2">
                                  <button
                                    type="button"
                                    onClick={() => openFormFile(f)}
                                    className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                    title="View attachment"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  {!isFieldDisabled && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveFile(fieldId, fIdx)}
                                      className="p-1 rounded text-slate-400 hover:text-red-600"
                                      title="Remove attachment"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : isFieldDisabled ? (
                          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-400 italic bg-slate-50 dark:bg-slate-900/40">
                            No files attached
                          </div>
                        ) : null}

                        {/* Upload in progress */}
                        {uploadingField === fieldId && (
                          <div className="flex items-center gap-2 p-2 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20 text-xs">
                            <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                            <div className="flex-1">
                              <span className="font-semibold text-blue-900 dark:text-blue-300">
                                Uploading files… {uploadProgress}%
                              </span>
                              <div className="w-full h-1.5 bg-blue-200 dark:bg-blue-900 rounded-full mt-1 overflow-hidden">
                                <div
                                  className="h-full bg-blue-600 transition-all duration-200"
                                  style={{ width: `${uploadProgress}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Upload trigger button */}
                        {!isFieldDisabled && (
                          <div>
                            <label
                              htmlFor={`file-input-${fieldId}`}
                              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-dashed text-xs font-semibold cursor-pointer transition ${
                                err
                                  ? 'border-red-400 text-red-600 bg-red-50/50 hover:bg-red-100/50 dark:border-red-600 dark:text-red-400 dark:bg-red-950/20'
                                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                              }`}
                            >
                              <FileUp className="w-4 h-4 text-blue-500" />
                              <span>Attach Pictures or PDFs (up to 25 MB)</span>
                            </label>
                            <input
                              id={`file-input-${fieldId}`}
                              type="file"
                              multiple
                              accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
                              disabled={uploadingField === fieldId}
                              onChange={(e) => handleFileUpload(fieldId, e)}
                              className="hidden"
                            />
                          </div>
                        )}
                      </div>
                    ) : item.field_type === 'select' ? (
                      <select
                        id={fieldId}
                        value={val}
                        disabled={isFieldDisabled}
                        onChange={(e) => handleFieldChange(fieldId, e.target.value)}
                        className={`w-full h-10 rounded-xl border px-3 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-600 disabled:dark:text-slate-400 disabled:cursor-not-allowed ${
                          err
                            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600 focus:ring-blue-500'
                        }`}
                      >
                        <option value="">Choose an option…</option>
                        {(item.options || []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : item.field_type === 'multiselect' ? (
                      <MultiSelectDropdown
                        id={fieldId}
                        options={item.options || []}
                        value={Array.isArray(val) ? val : val ? [val] : []}
                        disabled={isFieldDisabled}
                        onChange={(newVal) => handleFieldChange(fieldId, newVal)}
                        placeholder={item.placeholder || 'Select one or more options…'}
                        error={Boolean(err)}
                      />
                    ) : item.field_type === 'radio' ? (
                      <div className="space-y-1.5 pt-1">
                        {(item.options || []).map((opt) => (
                          <label key={opt} className={`flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 ${isFieldDisabled ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}>
                            <input
                              type="radio"
                              name={fieldId}
                              value={opt}
                              checked={val === opt}
                              disabled={isFieldDisabled}
                              onChange={(e) => handleFieldChange(fieldId, e.target.value)}
                              className="text-blue-600 focus:ring-blue-500 h-4 w-4"
                            />
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>
                    ) : item.field_type === 'checkbox' ? (
                      <label className={`flex items-center gap-2 pt-1 text-sm text-slate-700 dark:text-slate-300 ${isFieldDisabled ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}>
                        <input
                          id={fieldId}
                          type="checkbox"
                          checked={Boolean(val)}
                          disabled={isFieldDisabled}
                          onChange={(e) => handleFieldChange(fieldId, e.target.checked)}
                          className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                        />
                        <span>{item.placeholder || item.caption}</span>
                      </label>
                    ) : (
                      <input
                        id={fieldId}
                        type={item.field_type || 'text'}
                        value={val}
                        disabled={isFieldDisabled}
                        onChange={(e) => handleFieldChange(fieldId, e.target.value)}
                        placeholder={item.placeholder}
                        className={`w-full h-10 rounded-xl border px-3 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-600 disabled:dark:text-slate-400 disabled:cursor-not-allowed ${
                          err
                            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600 focus:ring-blue-500'
                        }`}
                      />
                    )}

                    {err && <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{err}</p>}
                  </div>
                );
              })}
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
              {isReadOnly && (
                <button
                  type="button"
                  onClick={() => setIsPrinting(true)}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                >
                  <Printer className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  Print
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-xl border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                {isReadOnly ? 'Close' : 'Cancel'}
              </button>
              {!isReadOnly && (
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition shadow-sm"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {submitting ? 'Submitting…' : submission?.id ? 'Update Response' : 'Submit Form'}
                </button>
              )}
            </div>
          </form>
        )}

        {isPrinting && (
          <PrintableFormSubmission
            submission={
              submission || {
                id: 'preview',
                form_template_id: form?.id,
                form_template_name: form?.name,
                submitted_at: new Date().toISOString(),
                submitted_by_name: currentUser?.name || 'Member',
                data: answers,
              }
            }
            form={form}
            departmentName={departmentName}
            onDone={() => setIsPrinting(false)}
          />
        )}
      </div>
    </div>
  );
};

// Modal sound definition for verify-sounds.mjs

