import React, { useEffect, useState } from 'react';
import { AlertCircle, FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import { deleteFormTemplate, fetchAdminFormTemplates, saveFormTemplate } from '../../services/api';
import { FIELD_KINDS, SOURCE_KINDS, groupLinkages, sourceLinkages } from '../../utils/formDefinition';
import { FORM_BLANKS, loadBundledBlank } from '../../utils/formCatalog';
import { listFormFields } from '../../utils/formFill';
import { TRAINING_FLAGS } from '../../utils/training';
import { categoryPairsFrom } from '../../utils/trainingSummary';

// Printable form definitions: which blank PDF a form fills, which data feeds it, and where each value goes.
//
// THE FIELD MAPPER IS THE WHOLE POINT OF THIS SCREEN. A blank's field names are not guessable - they are whatever the
// state's PDF happened to call them - so the screen reads them OFF THE BLANK (`listFormFields`, which pdf-lib can do)
// and offers each one to be filled. An officer never types a field name; they pick it and point it at a value.
//
// THE BLANKS ARE BUNDLED FILES, so there is no upload here: the picker lists what utils/formCatalog registers, and if
// nothing is registered yet the screen says so rather than offering an empty form. That is the honest state - the engine
// was built before the blanks were - and it is why this screen works today with no PDF in the repo.
const EMPTY_FORM = {
  id: '',
  name: '',
  description: '',
  source: 'training_summary',
  template: { id: '' },
  fields: {},
  enabled: true,
  audience_all: true,
  audience_role_ids: [],
  audience_rank_ids: [],
};

const FORM_ID = 'form-template-editor';
const FIELD_CLASS =
  'mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white';

const toggleId = (values, id) =>
  values.includes(id) ? values.filter((value) => value !== id) : [...values, id];

export default function AdminFormsTab({ roles = [], ranks = [] }) {
  const [forms, setForms] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  // The fields the chosen BLANK declares, and how reading them went - kept apart from the definition, because a blank
  // that cannot be read is not a reason to lose what the officer has typed.
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

  // Read the chosen blank's own fields. Cancelled on a change of blank, so a slow read for a blank the officer has moved
  // away from cannot land on top of the one they moved to.
  useEffect(() => {
    const templateId = String(form.template && form.template.id ? form.template.id : '');
    if (!editorOpen || !templateId) {
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
  }, [editorOpen, form.template]);

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
      template: { id: String((stored.template && stored.template.id) || '') },
      fields: { ...(stored.fields || {}) },
      audience_role_ids: Array.isArray(stored.audience_role_ids) ? stored.audience_role_ids : [],
      audience_rank_ids: Array.isArray(stored.audience_rank_ids) ? stored.audience_rank_ids : [],
    });
  };

  // One field's mapping. An emptied `from` REMOVES the entry rather than storing a blank instruction, so what is saved is
  // only what the officer actually mapped.
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
      await saveFormTemplate({
        id: form.id || undefined,
        definition: {
          name: form.name,
          description: form.description,
          source: form.source,
          template: { id: form.template.id },
          fields: form.fields,
          enabled: form.enabled,
          audience_all: form.audience_all,
          audience_role_ids: form.audience_role_ids,
          audience_rank_ids: form.audience_rank_ids,
        },
      });
      closeEditor();
      await refresh();
    } catch (failure) {
      // The writer normalises through the same pure validator the screen would, so its message is the one to show.
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

  const mappedCount = Object.keys(form.fields || {}).length;
  // The paths the chosen source offers, straight from its own registry entry. The categories go in because this source
  // widens to one `totals.<flag>` per category the station uses, so a category added later appears here on its own.
  const linkages = sourceLinkages(form.source, { categories: categoryPairsFrom(TRAINING_FLAGS) });
  const linkageGroups = groupLinkages(linkages);

  return (
    <div className="space-y-4">
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-red-500" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Form definitions</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Printable PDFs filled from the app’s own data.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={beginNew}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-500"
          >
            <Plus className="h-4 w-4" /> New form
          </button>
        </header>

        {error && !editorOpen && (
          <div role="alert" className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
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
            {forms.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-900 dark:text-white">{row.name}</span>
                    {!row.enabled && (
                      <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">Disabled</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {(SOURCE_KINDS[row.source] || {}).label || row.source} · {Object.keys(row.fields || {}).length} field
                    {Object.keys(row.fields || {}).length === 1 ? '' : 's'} mapped
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
            ))}
          </div>
        )}
      </section>

      {editorOpen && (
        <ViewportModal
          title={form.id ? 'Edit form' : 'New form'}
          subtitle={form.id ? form.name : 'Not saved yet'}
          formId={FORM_ID}
          saveLabel={form.id ? 'Save changes' : 'Save form'}
          saving={saving}
          onClose={closeEditor}
        >
          <form id={FORM_ID} onSubmit={handleSave} className="space-y-4">
            {error && (
              <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Name
                <input required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={FIELD_CLASS} />
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Data source
                <select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} className={FIELD_CLASS}>
                  {Object.values(SOURCE_KINDS).map((kind) => (
                    <option key={kind.key} value={kind.key}>{kind.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 sm:col-span-2">
                Description (optional)
                <textarea maxLength={300} rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
              </label>
            </div>

            <fieldset className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
              <legend className="text-xs font-semibold text-slate-700 dark:text-slate-200">The blank PDF</legend>
              {FORM_BLANKS.length === 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  No blank PDFs are registered yet. Drop one into <code>public/forms/</code> and add a row to
                  <code> src/utils/formCatalog.js</code>, and its fields will appear here to be mapped.
                </p>
              ) : (
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 sm:max-w-sm">
                  Blank
                  <select
                    value={form.template.id}
                    onChange={(event) => setForm((prev) => ({ ...prev, template: { id: event.target.value } }))}
                    className={FIELD_CLASS}
                  >
                    <option value="">Choose a blank…</option>
                    {FORM_BLANKS.map((blank) => (
                      <option key={blank.id} value={blank.id}>{blank.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </fieldset>

            <fieldset className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
              <legend className="text-xs font-semibold text-slate-700 dark:text-slate-200">Where each value goes</legend>
              {linkages.length > 0 && (
                // THE PATHS ON OFFER, taken from the source's own registry entry rather than a list kept here - so what
                // this names and what the source can actually fill stay the same thing, because the list lives beside
                // the `contextFor` that produces it. scripts/verify-forms asserts every path here resolves.
                //
                // It sits above the mapper rather than behind a disclosure: this app has no `<details>` anywhere, and a
                // React `<details open>` re-asserts itself on every render, which would snap it open under the officer
                // as they typed. A compact panel is duller and behaves.
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Values that come from this source{' '}
                    <span className="font-normal text-slate-500 dark:text-slate-400">({linkages.length})</span>
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
                              <code className="font-mono text-[11px] text-red-700 dark:text-red-300">{linkage.from}</code>
                              <span className="text-slate-500 dark:text-slate-400"> — {linkage.label}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    Anything left unmapped prints blank; the start and end of the period are only filled in when the form is
                    run with a period. For text that is not from the data, type <code className="font-mono">literal:</code>{' '}
                    then the text - for example <code className="font-mono">literal:Station copy</code>.
                  </p>
                </div>
              )}
              <datalist id="form-linkage-options">
                {linkages.map((linkage) => (
                  <option key={linkage.from} value={linkage.from}>{linkage.label}</option>
                ))}
              </datalist>
              {form.template.id === '' ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">Choose a blank and its fields appear here to be filled.</p>
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
                    {blankFields.length} field{blankFields.length === 1 ? '' : 's'} on this blank; fill the ones this form
                    needs ({mappedCount} mapped).
                  </p>
                  {blankFields.map((field) => {
                    const entry = form.fields[field.name] || {};
                    return (
                      <div key={field.name} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_7rem]">
                        <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-200" title={`${field.name} (${field.type})`}>
                          {field.name} <span className="font-normal text-slate-400">({field.type})</span>
                        </span>
                        <input
                          value={entry.from || ''}
                          onChange={(event) => mapField(field.name, { from: event.target.value })}
                          list="form-linkage-options"
                          placeholder="e.g. totals.is_hazmat"
                          aria-label={`Value for ${field.name}`}
                          className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                        />
                        <select
                          value={entry.as || 'text'}
                          onChange={(event) => mapField(field.name, { as: event.target.value })}
                          aria-label={`Field type for ${field.name}`}
                          className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                        >
                          {FIELD_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
              <legend className="text-xs font-semibold text-slate-700 dark:text-slate-200">Who can generate this form?</legend>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={form.audience_all} onChange={(event) => setForm({ ...form, audience_all: event.target.checked })} className="accent-red-600" />
                Everyone
              </label>
              {!form.audience_all && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase text-slate-500">Roles</p>
                    {roles.map((role) => {
                      const id = String(role.id);
                      return (
                        <label key={id} className="flex items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200">
                          <input type="checkbox" checked={form.audience_role_ids.includes(id)} onChange={() => setForm({ ...form, audience_role_ids: toggleId(form.audience_role_ids, id) })} className="accent-red-600" />
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
                        <label key={id} className="flex items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200">
                          <input type="checkbox" checked={form.audience_rank_ids.includes(id)} onChange={() => setForm({ ...form, audience_rank_ids: toggleId(form.audience_rank_ids, id) })} className="accent-red-600" />
                          {rank.description || rank.name || id}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                A matching role or rank is who may generate this form. It is not a permission - the role still has to be
                able to reach the screen the form is run from.
              </p>
            </fieldset>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="accent-red-600" />
                Enabled
              </label>
            </div>
          </form>
        </ViewportModal>
      )}

      {pendingDelete && (
        <ConfirmModal
          title={`Delete ${pendingDelete.name}?`}
          message="Officers will no longer be able to generate this form. Sheets already handed out are unaffected."
          confirmLabel="Delete form"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}





