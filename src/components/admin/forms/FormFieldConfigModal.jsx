import React, { useState } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { ENTERED_FIELD_KINDS, sanitizeDataName } from '../../../utils/formDefinition';
import { renderInViewport } from '../../../utils/viewportLayer';

export default function FormFieldConfigModal({ item, onSave, onClose }) {
  const [fieldType, setFieldType] = useState(item.field_type || 'text');
  const [caption, setCaption] = useState(item.caption || '');
  const [dataName, setDataName] = useState(item.data_name || '');
  const [colSpan, setColSpan] = useState(item.col_span || 3);
  const [required, setRequired] = useState(Boolean(item.required));
  const [defaultValue, setDefaultValue] = useState(item.default_value !== undefined ? String(item.default_value) : '');
  const [placeholder, setPlaceholder] = useState(item.placeholder || '');
  const [instructions, setInstructions] = useState(item.instructions || '');
  const [optionsText, setOptionsText] = useState((item.options || []).join('\n'));
  const [markdownContent, setMarkdownContent] = useState(item.markdown_content || '');
  const [minVal, setMinVal] = useState(item.validation?.min !== undefined ? String(item.validation.min) : '');
  const [maxVal, setMaxVal] = useState(item.validation?.max !== undefined ? String(item.validation.max) : '');
  const [pattern, setPattern] = useState(item.validation?.pattern || '');
  const [customHint, setCustomHint] = useState(item.validation?.custom_hint || '');
  const [error, setError] = useState('');

  const isMarkdown = fieldType === 'markdown';
  const isDivider = fieldType === 'divider';
  const isNonData = isMarkdown || isDivider;
  const isSignature = ['signature', 'signature_stamp'].includes(fieldType);

  const handleCaptionChange = (val) => {
    setCaption(val);
    if (!dataName || dataName === sanitizeDataName(caption) || dataName === item.data_name) {
      setDataName(sanitizeDataName(val));
    }
  };

  const handleDataNameChange = (val) => {
    // Convert uppercase to lowercase and map spaces/hyphens to underscores.
    // Allow typing lowercase letters, numbers, and underscores directly without stripping
    // trailing or intermediate underscores while the user is actively typing.
    const cleaned = String(val ?? '')
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 50);
    setDataName(cleaned);
  };

  const handleSubmit = (e) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
      e.stopPropagation();
    }
    setError('');

    if (!isNonData && !caption.trim()) {
      setError('Please provide a field caption/label.');
      return;
    }

    const finalDataName = isNonData ? '' : sanitizeDataName(dataName || caption);
    if (!isNonData && !finalDataName) {
      setError('Please provide a valid data field name (lowercase letters, numbers, underscores).');
      return;
    }

    const options = (optionsText || '')
      .split('\n')
      .map((opt) => opt.trim())
      .filter(Boolean);

    if (['select', 'radio'].includes(fieldType) && options.length === 0) {
      setError('Dropdown and radio fields require at least one option.');
      return;
    }

    const validation = {};
    if (minVal !== '' && !Number.isNaN(Number(minVal))) validation.min = Number(minVal);
    if (maxVal !== '' && !Number.isNaN(Number(maxVal))) validation.max = Number(maxVal);
    if (pattern.trim()) validation.pattern = pattern.trim();
    if (customHint.trim()) validation.custom_hint = customHint.trim();

    onSave({
      ...item,
      field_type: fieldType,
      caption: isMarkdown ? 'Instructions' : isDivider ? caption.trim() : caption.trim(),
      data_name: finalDataName,
      col_span: Number(colSpan) || 3,
      required: isNonData ? false : required,
      default_value: isNonData || isSignature ? '' : defaultValue,
      placeholder: isNonData || isSignature ? '' : placeholder.trim(),
      instructions: isMarkdown ? '' : instructions.trim(),
      options: isNonData || isSignature ? [] : options,
      validation: isNonData || isSignature ? {} : validation,
      markdown_content: isMarkdown ? markdownContent : '',
    });
  };

  const FIELD_TYPE_LABELS = {
    text: 'Single-line Text',
    textarea: 'Multi-line Text (Textarea)',
    tel: 'Telephone Number',
    number: 'Number',
    date: 'Date',
    time: 'Time',
    select: 'Dropdown Menu',
    checkbox: 'Checkbox (Yes/No)',
    radio: 'Radio Selection',
    signature: 'E-Signature (Finger / Stylus Draw)',
    signature_stamp: 'E-Signature Button (Digital Stamp)',
    divider: 'Divider / Section Line',
    markdown: 'Markdown Instructions (Read-only)',
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      e.stopPropagation();
      handleSubmit(e);
    }
  };

  return renderInViewport(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="field-config-title"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <div>
            <h2 id="field-config-title" className="text-base font-bold text-slate-900 dark:text-white">
              Configure Form Field
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Customize properties, validation, and layout for this field.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 sm:col-span-2">
              Field Type
              <select
                value={fieldType}
                onChange={(e) => setFieldType(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                {ENTERED_FIELD_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {FIELD_TYPE_LABELS[kind] || kind}
                  </option>
                ))}
              </select>
            </label>

            {isMarkdown ? (
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Instruction Markdown Content
                  <textarea
                    rows={6}
                    value={markdownContent}
                    onChange={(e) => setMarkdownContent(e.target.value)}
                    placeholder="Enter instructions, notes, or guidance formatted in Markdown..."
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Supports headers (#), bold, lists, alerts (&gt; [!NOTE]), and bullet points. Read-only to members.
                </p>
              </div>
            ) : isDivider ? (
              <div className="sm:col-span-2 space-y-3">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Section Header / Caption (optional)
                  <input
                    type="text"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="e.g. Apparatus Details, Facilities Inspection (or leave blank for line only)"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Renders a non-editable horizontal line to divide sections. If a caption is given, it appears as a section title.
                </p>

                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                  Width on Form
                  <select
                    value={colSpan}
                    onChange={(e) => setColSpan(Number(e.target.value))}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={1}>1/3 Width</option>
                    <option value={2}>2/3 Width</option>
                    <option value={3}>Full Width</option>
                  </select>
                </label>
              </div>
            ) : (
              <>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 sm:col-span-2">
                  {isSignature
                    ? 'Signature Prompt / Caption'
                    : 'Caption / Question Label'}
                  <input
                    type="text"
                    required
                    value={caption}
                    onChange={(e) => handleCaptionChange(e.target.value)}
                    placeholder={
                      isSignature
                        ? 'e.g. Member Signature, Officer Signature'
                        : fieldType === 'tel'
                        ? 'e.g. Contact Phone, Station Hotline'
                        : 'e.g. Odometer Reading, Equipment Status'
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 sm:col-span-2">
                  Instruction Text (optional)
                  <textarea
                    rows={2}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Helpful guidance, hints, or instructions shown directly beneath this field…"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="mt-1 block text-[11px] font-normal text-slate-500 dark:text-slate-400">
                    Additional context or instructions displayed to the member when completing this field.
                  </span>
                </label>

                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Data Name (Firestore Key)
                  <input
                    type="text"
                    required
                    value={dataName}
                    onChange={(e) => handleDataNameChange(e.target.value)}
                    placeholder={
                      isSignature
                        ? 'e.g. member_signature'
                        : fieldType === 'tel'
                        ? 'e.g. phone_number'
                        : 'e.g. odometer_reading'
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-mono text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="mt-1 block text-[11px] font-normal text-slate-500 dark:text-slate-400">
                    Lowercase letters, numbers, and underscores
                  </span>
                </label>

                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Width on Form
                  <select
                    value={colSpan}
                    onChange={(e) => setColSpan(Number(e.target.value))}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={1}>1/3 Width</option>
                    <option value={2}>2/3 Width</option>
                    <option value={3}>Full Width</option>
                  </select>
                </label>

                <div className="sm:col-span-2 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={required}
                      onChange={(e) => setRequired(e.target.checked)}
                      className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Required field (must be completed to submit)
                    </span>
                  </label>
                </div>

                {!isSignature && (
                  <>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Placeholder (Optional)
                      <input
                        type="text"
                        value={placeholder}
                        onChange={(e) => setPlaceholder(e.target.value)}
                        placeholder={
                          fieldType === 'tel'
                            ? '(555) 000-0000 x123'
                            : 'Guidance shown inside field'
                        }
                        className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                      />
                    </label>

                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Default Value (Optional)
                      <input
                        type="text"
                        value={defaultValue}
                        onChange={(e) => setDefaultValue(e.target.value)}
                        placeholder="Initial default value"
                        className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                  </>
                )}

                {['select', 'radio'].includes(fieldType) && (
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Options (one per line)
                      <textarea
                        rows={3}
                        value={optionsText}
                        onChange={(e) => setOptionsText(e.target.value)}
                        placeholder="Option 1&#10;Option 2&#10;Option 3"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                  </div>
                )}

                {/* Validation rules */}
                {!isSignature && (
                  <fieldset className="sm:col-span-2 border-t border-slate-200 dark:border-slate-700 pt-3 space-y-3">
                    <legend className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Validation Rules (Optional)
                    </legend>

                    {fieldType === 'number' && (
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                          Minimum Value
                          <input
                            type="number"
                            value={minVal}
                            onChange={(e) => setMinVal(e.target.value)}
                            className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                          />
                        </label>
                        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                          Maximum Value
                          <input
                            type="number"
                            value={maxVal}
                            onChange={(e) => setMaxVal(e.target.value)}
                            className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                          />
                        </label>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        Regex Pattern
                        <input
                          type="text"
                          value={pattern}
                          onChange={(e) => setPattern(e.target.value)}
                          placeholder={
                            fieldType === 'tel'
                              ? '^\\(\\d{3}\\)\\s\\d{3}-\\d{4}.*'
                              : 'e.g. ^[0-9]{5}$'
                          }
                          className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-mono text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                        />
                      </label>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        Custom Error Hint
                        <input
                          type="text"
                          value={customHint}
                          onChange={(e) => setCustomHint(e.target.value)}
                          placeholder="e.g. Must be a valid phone number"
                          className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                        />
                      </label>
                    </div>
                  </fieldset>
                )}
              </>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-xl border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-500 transition shadow-sm"
            >
              <Check className="h-4 w-4" /> Save Field
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
