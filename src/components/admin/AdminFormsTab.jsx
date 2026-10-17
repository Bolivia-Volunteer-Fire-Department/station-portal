import React, { useEffect, useState } from 'react';
import { AlertCircle, FileCheck, FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import { deleteFormTemplate, fetchAdminFormTemplates, saveFormTemplate } from '../../services/api';
import { FIELD_KINDS, SOURCE_KINDS, groupLinkages, sourceLinkages } from '../../utils/formDefinition';
import { FORM_BLANKS, loadBundledBlank } from '../../utils/formCatalog';
import { listFormFields } from '../../utils/formFill';
import { TRAINING_FLAGS } from '../../utils/training';
import { categoryPairsFrom } from '../../utils/trainingSummary';
import FormBuilderCanvas from './forms/FormBuilderCanvas';
import AdminSubmissionsTab from './forms/AdminSubmissionsTab';

// Settings for printable PDF forms and entered interactive forms.
const EMPTY_FORM = {
  id: '',
  name: '',
  description: '',
  form_type: 'generated',
  source: 'training_summary',
  template: { id: '' },
  fields: {},
  layout: [],
  enabled: true,
  allow_editing_after_submission: false,
  audience_all: true,
  audience_role_ids: [],
  audience_rank_ids: [],
};

const FORM_ID = 'form-template-editor';
const FIELD_CLASS =
  'mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white';

const toggleId = (values, id) =>
  values.includes(id) ? values.filter((value) => value !== id) : [...values, id];

export default function AdminFormsTab({
  roles = [],
  ranks = [],
  departmentName = '',
  departmentLogoUrl = '',
  currentUser = null,
  currentUserName = '',
  currentUserId = '',
}) {
  const [activeSubTab, setActiveSubTab] = useState('templates');
  const [forms, setForms] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  // Fields found inside the selected blank PDF.
  const [blankFields, setBlankFields] = useState([]);
  const [fieldsError, setFieldsError] = useState('');
  const [readingFields, setReadingFields] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setForms(await fetchAdminFormTemplates());
    } catch (failure) {
      setError(failure.message || 'Could not load form definitions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Read the fields from the selected blank PDF file (for generated forms).
  useEffect(() => {
    const templateId = String(form.template && form.template.id ? form.template.id : '');
    if (!editorOpen || form.form_type !== 'generated' || !templateId) {
      setBlankFields([]);
      setFieldsError('');
      return undefined;
    }
    let cancelled = false;
    setReadingFields(true);
    setFieldsError('');
    loadBundledBlank(templateId, { baseUrl: import.meta.env.BASE_URL })
      .then((bytes) => listFormFields(bytes))
      .then((fields) => {
        if (!cancelled) setBlankFields(fields);
      })
      .catch((failure) => {
        if (cancelled) return;
        setBlankFields([]);
        setFieldsError(failure.message || 'Could not read the blank PDF.');
      })
      .finally(() => {
        if (!cancelled) setReadingFields(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editorOpen, form.template, form.form_type]);

  const beginNew = () => {
    setError('');
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setForm(EMPTY_FORM);
  };

  const beginEdit = (stored) => {
    setError('');
    setEditorOpen(true);
    setForm({
      ...EMPTY_FORM,
      ...stored,
      form_type: stored.form_type === 'entered' ? 'entered' : 'generated',
      template: { id: String((stored.template && stored.template.id) || '') },
      fields: { ...(stored.fields || {}) },
      layout: Array.isArray(stored.layout) ? stored.layout : [],
      allow_editing_after_submission: Boolean(stored.allow_editing_after_submission),
      audience_role_ids: Array.isArray(stored.audience_role_ids) ? stored.audience_role_ids : [],
      audience_rank_ids: Array.isArray(stored.audience_rank_ids) ? stored.audience_rank_ids : [],
    });
  };

  // Updates how a single form field gets its value (for generated forms).
  const mapField = (name, patch) =>
    setForm((prev) => {
      const next = { ...(prev.fields || {}) };
      const merged = { as: 'text', ...(next[name] || {}), ...patch };
      if (!String(merged.from || '').trim()) delete next[name];
      else next[name] = merged;
      return { ...prev, fields: next };
    });

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const isEntered = form.form_type === 'entered';
      const definition = isEntered
        ? {
            name: form.name,
            description: form.description,
            form_type: 'entered',
            layout: form.layout,
            enabled: form.enabled,
            allow_editing_after_submission: Boolean(form.allow_editing_after_submission),
            audience_all: form.audience_all,
            audience_role_ids: form.audience_role_ids,
            audience_rank_ids: form.audience_rank_ids,
          }
        : {
            name: form.name,
            description: form.description,
            form_type: 'generated',
            source: form.source,
            template: { id: form.template.id },
            fields: form.fields,
            enabled: form.enabled,
            audience_all: form.audience_all,
            audience_role_ids: form.audience_role_ids,
            audience_rank_ids: form.audience_rank_ids,
          };

      await saveFormTemplate({
        id: form.id || undefined,
        definition,
      });
      closeEditor();
      await refresh();
    } catch (failure) {
      setError(failure.message || 'Could not save this form.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      await deleteFormTemplate(target.id);
      await refresh();
    } catch (failure) {
      setError(failure.message || 'Could not delete this form.');
    }
  };

  const isEntered = form.form_type === 'entered';
  // Available data fields that can be placed into the form (for generated forms).
  const linkages = sourceLinkages(form.source, { categories: categoryPairsFrom(TRAINING_FLAGS) });
  const linkageGroups = groupLinkages(linkages);

  return (
    <div className="space-y-4">
      {/* Top View Toggle: Templates vs Completed Submissions */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
        <button
          type="button"
          onClick={() => setActiveSubTab('templates')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition ${
            activeSubTab === 'templates'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Form Templates</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('submissions')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition ${
            activeSubTab === 'submissions'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
          }`}
        >
          <FileCheck className="w-4 h-4" />
          <span>Completed Submissions</span>
        </button>
      </div>

      {activeSubTab === 'submissions' ? (
        <AdminSubmissionsTab
          formTemplates={forms}
          departmentName={departmentName}
          departmentLogoUrl={departmentLogoUrl}
          currentUser={currentUser}
          currentUserName={currentUserName}
          currentUserId={currentUserId}
        />
      ) : (
        <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-red-500" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Form Definitions</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Configure interactive entry forms or printable PDF templates.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={beginNew}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-500"
            >
              <Plus className="h-4 w-4" /> New Form
            </button>
          </header>

          {error && !editorOpen && (
            <div
              role="alert"
              className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading forms…
            </div>
          ) : forms.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No forms configured.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
              {forms.map((row) => {
                const isItemEntered = row.form_type === 'entered';
                return (
                  <div key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900 dark:text-white">{row.name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            isItemEntered
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                              : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800'
                          }`}
                        >
                          {isItemEntered ? 'Interactive Form' : 'PDF Export'}
                        </span>
                        {isItemEntered && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider ${
                              row.allow_editing_after_submission
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {row.allow_editing_after_submission ? 'Editable after submit' : 'Locked on submit'}
                          </span>
                        )}
                        {!row.enabled && (
                          <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                            Disabled
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {isItemEntered
                          ? `${(row.layout || []).length} field item${(row.layout || []).length === 1 ? '' : 's'}`
                          : `${(SOURCE_KINDS[row.source] || {}).label || row.source} · ${
                              Object.keys(row.fields || {}).length
                            } field${Object.keys(row.fields || {}).length === 1 ? '' : 's'} mapped`}
                        {row.description ? ` · ${row.description}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => beginEdit(row)}
                      title={`Edit ${row.name}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(row)}
                      title={`Delete ${row.name}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {editorOpen && (
        <ViewportModal
          title={form.id ? 'Edit Form' : 'New Form'}
          subtitle={form.id ? form.name : 'Configure template & layout'}
          formId={FORM_ID}
          saveLabel={form.id ? 'Save Changes' : 'Save Form'}
          saving={saving}
          onClose={closeEditor}
        >
          <form id={FORM_ID} onSubmit={handleSave} className="space-y-5">
            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
              >
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Form Type
                <select
                  value={form.form_type || 'generated'}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      form_type: event.target.value,
                    })
                  }
                  className={FIELD_CLASS}
                >
                  <option value="generated">Generated Form (fills PDF from system data)</option>
                  <option value="entered">Entered Form (completed by member)</option>
                </select>
              </label>

              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Name
                <input
                  required
                  maxLength={80}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="e.g. Apparatus Pre-Trip Check, Member Training Export"
                  className={FIELD_CLASS}
                />
              </label>

              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 sm:col-span-2">
                Description (optional)
                <textarea
                  maxLength={300}
                  rows={2}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="Brief summary shown in the form catalogue…"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
            </div>

            {/* If Entered Form: Render Drag-and-Drop Form Builder Canvas */}
            {isEntered ? (
              <fieldset className="border-t border-slate-200 pt-4 dark:border-slate-700 space-y-3">
                <div className="flex items-start gap-3 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 p-3.5">
                  <input
                    id="allow-edit-after-submit"
                    type="checkbox"
                    checked={Boolean(form.allow_editing_after_submission)}
                    onChange={(event) =>
                      setForm({ ...form, allow_editing_after_submission: event.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 rounded accent-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                  <label htmlFor="allow-edit-after-submit" className="text-xs text-slate-800 dark:text-slate-200 cursor-pointer">
                    <span className="font-semibold block text-slate-900 dark:text-white">
                      Allow members to edit responses after submitting
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                      When checked, members can re-open their completed form from their account to update their answers. When unchecked, submissions are finalized upon submission.
                    </span>
                  </label>
                </div>

                <div>
                  <legend className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
                    Form Template Builder
                  </legend>
                  <FormBuilderCanvas
                    layout={form.layout || []}
                    onChange={(newLayout) => setForm((prev) => ({ ...prev, layout: newLayout }))}
                  />
                </div>
              </fieldset>
            ) : (
              /* If Generated Form: Render Blank PDF & Data Mapping Table */
              <>
                <div className="grid gap-4 sm:grid-cols-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Data source
                    <select
                      value={form.source}
                      onChange={(event) => setForm({ ...form, source: event.target.value })}
                      className={FIELD_CLASS}
                    >
                      {Object.values(SOURCE_KINDS).map((kind) => (
                        <option key={kind.key} value={kind.key}>
                          {kind.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Blank PDF Template
                    <select
                      value={form.template.id}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, template: { id: event.target.value } }))
                      }
                      className={FIELD_CLASS}
                    >
                      <option value="">Choose a blank…</option>
                      {FORM_BLANKS.map((blank) => (
                        <option key={blank.id} value={blank.id}>
                          {blank.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <fieldset className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
                  <legend className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Where each value goes
                  </legend>
                  {linkages.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Values that come from this source{' '}
                        <span className="font-normal text-slate-500 dark:text-slate-400">
                          ({linkages.length})
                        </span>
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {linkageGroups.map((group) => (
                          <div key={group.group}>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              {group.group}
                            </p>
                            <ul className="mt-1 space-y-0.5">
                              {group.values.map((linkage) => (
                                <li key={linkage.from} className="text-xs leading-snug">
                                  <code className="font-mono text-[11px] text-red-700 dark:text-red-300">
                                    {linkage.from}
                                  </code>
                                  <span className="text-slate-500 dark:text-slate-400"> — {linkage.label}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <datalist id="form-linkage-options">
                    {linkages.map((linkage) => (
                      <option key={linkage.from} value={linkage.from}>
                        {linkage.label}
                      </option>
                    ))}
                  </datalist>

                  {form.template.id === '' ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Choose a blank and its fields appear here to be filled.
                    </p>
                  ) : readingFields ? (
                    <p className="flex items-center gap-2 text-xs text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the blank’s fields…
                    </p>
                  ) : fieldsError ? (
                    <p className="text-xs text-red-600 dark:text-red-400">{fieldsError}</p>
                  ) : blankFields.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">That blank has no fillable fields.</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {blankFields.length} field{blankFields.length === 1 ? '' : 's'} on this blank; fill the ones
                        this form needs.
                      </p>
                      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
                        {blankFields.map((field) => {
                          const mapping = form.fields[field.name] || {};
                          return (
                            <div
                              key={field.name}
                              className="grid gap-2 p-3 sm:grid-cols-12 sm:items-center text-xs"
                            >
                              <div className="sm:col-span-4">
                                <span className="font-semibold text-slate-900 dark:text-white">{field.name}</span>
                                <span className="ml-1 text-[11px] text-slate-500">({field.type})</span>
                              </div>
                              <div className="sm:col-span-6">
                                <input
                                  type="text"
                                  list="form-linkage-options"
                                  value={mapping.from || ''}
                                  placeholder="Path or literal:value"
                                  onChange={(e) => mapField(field.name, { from: e.target.value })}
                                  className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800"
                                />
                              </div>
                              <div className="sm:col-span-2">
                                <select
                                  value={mapping.as || 'text'}
                                  onChange={(e) => mapField(field.name, { as: e.target.value })}
                                  className="h-8 w-full rounded border border-slate-300 bg-white px-1 text-xs dark:border-slate-600 dark:bg-slate-800"
                                >
                                  {FIELD_KINDS.map((kind) => (
                                    <option key={kind} value={kind}>
                                      {kind}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </fieldset>
              </>
            )}

            {/* Audience Permissions: Shared by both Generated and Entered forms */}
            <fieldset className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
              <legend className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Who can access this form?
              </legend>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={form.audience_all}
                  onChange={(event) => setForm({ ...form, audience_all: event.target.checked })}
                  className="accent-red-600"
                />
                Everyone
              </label>
              {!form.audience_all && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase text-slate-500">Roles</p>
                    {roles.map((role) => {
                      const id = String(role.id);
                      return (
                        <label
                          key={id}
                          className="flex items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200"
                        >
                          <input
                            type="checkbox"
                            checked={form.audience_role_ids.includes(id)}
                            onChange={() =>
                              setForm({
                                ...form,
                                audience_role_ids: toggleId(form.audience_role_ids, id),
                              })
                            }
                            className="accent-red-600"
                          />
                          {role.description || role.name || id}
                        </label>
                      );
                    })}
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase text-slate-500">Ranks</p>
                    {ranks.map((rank) => {
                      const id = String(rank.id);
                      return (
                        <label
                          key={id}
                          className="flex items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200"
                        >
                          <input
                            type="checkbox"
                            checked={form.audience_rank_ids.includes(id)}
                            onChange={() =>
                              setForm({
                                ...form,
                                audience_rank_ids: toggleId(form.audience_rank_ids, id),
                              })
                            }
                            className="accent-red-600"
                          />
                          {rank.description || rank.name || id}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                A matching role or rank determines who may view and use this form.
              </p>
            </fieldset>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                  className="accent-red-600"
                />
                Enabled
              </label>
            </div>
          </form>
        </ViewportModal>
      )}

      {pendingDelete && (
        <ConfirmModal
          title={`Delete ${pendingDelete.name}?`}
          message="Members will no longer be able to access or complete this form. Submissions already recorded are unaffected."
          confirmLabel="Delete form"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
