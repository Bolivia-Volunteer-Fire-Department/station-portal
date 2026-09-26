import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, FolderInput, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import {
  adminDeleteChecklistItem,
  adminDeleteDocument,
  adminFetchDocument,
  fetchDocumentSignatures,
  adminFetchDocuments,
  adminRemoveDocumentSignature,
  adminRenameDocumentFolder,
  adminSaveChecklistItem,
  adminSaveDocument,
} from '../../services/api';
import { toast } from '../../utils/toast';
import ConfirmModal from '../ConfirmModal';
import MarkdownEditor from '../MarkdownEditor';
import { authorLabel } from '../../utils/authorLabel';
import { unnamedLabel } from '../../utils/displayLabel';
import { parseRankOrder, rankLabel } from '../../utils/rankEligibility';
import {
  DOCUMENT_TYPES,
  EMPTY_DOCUMENT_FORM,
  UNFILED_LABEL,
  documentFolders,
  documentSaveProblem,
  documentToForm,
  documentUpdatedLabel,
  groupDocumentsByFolder,
  normalizeChecklistItemList,
  normalizeDocumentList,
  normalizeSignatureList,
  signatureDateLabel,
} from '../../utils/documents';

const EMPTY_ITEM_FORM = { id: '', label: '', section: '', sort_order: 0 };

// Saving or removing an item writes to the ITEMS sheet, but the document row is what carries the version this
// editor sends back - and `upsertSheetRowById` moves that version on any write, including one that only touches
// `content_revision`. Re-stating it locally after an item write is what keeps the next document save from being
// refused as a concurrent edit: to the admin that refusal would say somebody else had been editing the document,
// and there would be no way to tell it apart from the real thing.
//
// The form is NOT reloaded from the server here on purpose: an admin who added an item halfway through rewriting
// the text would lose what they had typed.
const advanceRowVersion = (value) => String((Number.parseInt(value, 10) || 0) + 1);

const fieldClass =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500';

const labelClass = 'block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5';

// The Documents tab: write and manage the station's documents.
//
// The list is metadata (one request per open, not per keystroke) and a body is fetched when a document is
// selected, so opening this tab on a station with a hundred documents costs what it costs on a fresh one. A save
// goes through one action that creates or updates by id, and the list is reloaded from the server afterwards
// rather than patched locally - the server owns `sort_order`, the revision and the author, and a locally patched
// row would eventually disagree with all three.
export default function AdminDocumentsTab({ token, ranks = [], users = [], timeFormat = '12', onDataChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(EMPTY_DOCUMENT_FORM);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState({ from: '', to: '' });
  // The signature report for the open document: fetched separately from the body, because a document body and a
  // list of who has signed it are different questions asked at different times.
  const [signatures, setSignatures] = useState([]);
  const [loadingSignatures, setLoadingSignatures] = useState(false);
  const [signaturesError, setSignaturesError] = useState('');
  const [pendingSignatureRemoval, setPendingSignatureRemoval] = useState(null);
  const [removingSignature, setRemovingSignature] = useState(false);
  // The checklist items of the document being edited, and the item form. Items are their own records because a
  // signature points at an item's id: editing the wording keeps the id, so what somebody signed stays attached to
  // what they signed.
  const [items, setItems] = useState([]);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM_FORM);
  const [savingItem, setSavingItem] = useState(false);
  const [pendingItemRemoval, setPendingItemRemoval] = useState(null);
  const [removingItem, setRemovingItem] = useState(false);
  // Items typed before the document exists. A checklist's items need a document to belong to, so on a NEW checklist
  // they are held here and written the moment the document is created - rather than making the author save, reopen
  // and start again, which is exactly what made this look unimplemented.
  const [stagedItems, setStagedItems] = useState([]);

  const memberLabel = useCallback(
    (userId) => {
      const found = (Array.isArray(users) ? users : []).find((user) => String(user?.id) === String(userId));
      const name = found ? String(found.name || '').trim() : '';
      // A member who cannot be resolved reads as a phrase rather than as their id: it happens when they have been
      // deleted since they signed, which a reader should not have to interpret a UUID to understand.
      return name || unnamedLabel('member');
    },
    [users]
  );

  // The minimum-rank choices, highest rank first. Built from the ranks themselves rather than from
  // `minRankChoices` (which collapses equal orders into one entry) because a document stores a rank ID, so two
  // ranks sharing an order have to stay distinguishable here.
  const rankChoices = useMemo(() => {
    const choices = [];
    (Array.isArray(ranks) ? ranks : []).forEach((rank) => {
      const order = parseRankOrder(rank.rank_order);
      if (order === null) return;
      choices.push({ id: String(rank.id ?? ''), order, label: rankLabel(rank) });
    });
    return choices.sort((a, b) => b.order - a.order);
  }, [ranks]);
  const folders = useMemo(() => documentFolders(rows), [rows]);
  const groups = useMemo(() => groupDocumentsByFolder(rows), [rows]);

  const loadRows = useCallback(async () => {
    const result = await adminFetchDocuments(token);
    if (!result?.success) throw new Error(result?.message || 'Could not load the documents.');
    return normalizeDocumentList(result.documents);
  }, [token]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setRows(await loadRows());
    } catch (err) {
      setLoadError(err?.message || 'Could not load the documents.');
    } finally {
      setLoading(false);
    }
  }, [loadRows]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const openDocument = async (id) => {
    setError('');
    setSignatures([]);
    setSignaturesError('');
    if (!id) {
      setForm(EMPTY_DOCUMENT_FORM);
      return;
    }
    setLoadingDocument(true);
    try {
      const result = await adminFetchDocument(id, token);
      if (!result?.success) throw new Error(result?.message || 'That document could not be opened.');
      setForm(documentToForm(result.document));
    } catch (err) {
      setError(err?.message || 'That document could not be opened.');
    } finally {
      setLoadingDocument(false);
    }
    loadSignatures(id);
  };

  // The signature report, asked for separately so a failure here still leaves the document editable. It carries
  // each signature's staleness, decided by the server against the document as it stands, so this screen and the
  // member's own view cannot disagree about which signatures predate the last edit.
  const loadSignatures = async (documentId) => {
    setLoadingSignatures(true);
    try {
      const result = await fetchDocumentSignatures(documentId, token);
      if (!result?.success) throw new Error(result?.message || 'Could not load the signatures.');
      setSignatures(normalizeSignatureList(result.signatures));
      // The same read carries the document's items, so a checklist's rows can be named without asking for the
      // document body a second time.
      setItems(normalizeChecklistItemList(result.items));
    } catch (err) {
      setSignatures([]);
      setSignaturesError(err?.message || 'Could not load the signatures.');
    } finally {
      setLoadingSignatures(false);
    }
  };

  // Checklist items: one at a time, each written through its own action so the server can bump the document's
  // revision and refuse the ones that must not change. On a document that does not exist yet there is nothing to
  // write against, so the item is staged instead - and `flushStagedItems` writes them the instant the document is
  // created.
  const handleSaveItem = async (event) => {
    event.preventDefault();
    if (savingItem) return;
    if (!String(itemForm.label || '').trim()) {
      toast.error('An item needs a label.');
      return;
    }

    // Staging: no document yet, so this is local. The order follows the list, ten apart, so an author who never
    // touches the Order field still gets the items in the order they typed them.
    if (!form.id) {
      const entry = {
        id: itemForm.id,
        label: itemForm.label,
        section: itemForm.section,
        sort_order: Number(itemForm.sort_order) || (stagedItems.length + 1) * 10,
      };
      setStagedItems((current) =>
        entry.id
          ? current.map((item) => (item.id === entry.id ? entry : item))
          : [...current, { ...entry, id: `staged-${current.length + 1}-${Date.now()}` }]
      );
      setItemForm(EMPTY_ITEM_FORM);
      return;
    }

    setSavingItem(true);
    try {
      const result = await adminSaveChecklistItem(
        {
          id: itemForm.id,
          document_id: form.id,
          label: itemForm.label,
          section: itemForm.section,
          sort_order: Number(itemForm.sort_order) || 0,
        },
        token
      );
      if (!result?.success) throw new Error(result?.message || 'Could not save the item.');
      setItems(normalizeChecklistItemList(result.items));
      setItemForm(EMPTY_ITEM_FORM);
      setForm((current) => ({ ...current, row_version: advanceRowVersion(current.row_version) }));
      toast.success(itemForm.id ? 'Item updated.' : 'Item added.');
      // The document changed, so its revision and its updated stamp have too. Reloaded rather than patched, for
      // the same reason a document save reloads the list.
      await refresh();
    } catch (err) {
      toast.error(err?.message || 'Could not save the item.');
    } finally {
      setSavingItem(false);
    }
  };

  const handleRemoveItem = async () => {
    const target = pendingItemRemoval;
    if (!target || removingItem) return;

    // A staged item was never written, so removing it is local - and there are no signatures to refuse it.
    if (!form.id || String(target.id).startsWith('staged-')) {
      setStagedItems((current) => current.filter((item) => item.id !== target.id));
      if (itemForm.id === target.id) setItemForm(EMPTY_ITEM_FORM);
      setPendingItemRemoval(null);
      return;
    }

    setRemovingItem(true);
    try {
      const result = await adminDeleteChecklistItem(target.id, token);
      if (!result?.success) throw new Error(result?.message || 'Could not remove the item.');
      setItems(normalizeChecklistItemList(result.items));
      if (itemForm.id === target.id) setItemForm(EMPTY_ITEM_FORM);
      setForm((current) => ({ ...current, row_version: advanceRowVersion(current.row_version) }));
      toast.success('Item removed.');
      await refresh();
    } catch (err) {
      toast.error(err?.message || 'Could not remove the item.');
    } finally {
      setPendingItemRemoval(null);
      setRemovingItem(false);
    }
  };

  const handleRemoveSignature = async () => {
    const target = pendingSignatureRemoval;
    if (!target || removingSignature) return;
    setRemovingSignature(true);
    try {
      const result = await adminRemoveDocumentSignature(target.id, token);
      if (!result?.success) throw new Error(result?.message || 'Could not remove the signature.');
      toast.success('Signature removed.');
      await loadSignatures(form.id);
      onDataChanged?.();
    } catch (err) {
      toast.error(err?.message || 'Could not remove the signature.');
    } finally {
      setPendingSignatureRemoval(null);
      setRemovingSignature(false);
    }
  };

  // Writes the items staged before the document existed, one request each - that action owns an item's id, and an
  // item is a record somebody will sign against, so it is worth a request of its own.
  //
  // What landed is COUNTED, not assumed. A checklist created with nine of ten items and a message saying ten would
  // be worse than one that said so: the missing line is a line nobody would think to sign.
  const flushStagedItems = async (documentId) => {
    const pending = stagedItems.slice();
    if (pending.length === 0) return { saved: 0, failed: 0 };

    let saved = 0;
    let failed = 0;
    for (const item of pending) {
      try {
        const result = await adminSaveChecklistItem(
          {
            id: '',
            document_id: documentId,
            label: item.label,
            section: item.section,
            sort_order: Number(item.sort_order) || 0,
          },
          token
        );
        if (result?.success) saved += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }

    setStagedItems([]);
    await loadSignatures(documentId);
    return { saved, failed };
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (saving) return;

    const problem = documentSaveProblem(form);
    if (problem) {
      setError(problem);
      return;
    }

    setError('');
    setSaving(true);
    // Captured before the await: an item can only be written once the document it belongs to has an id, so this is
    // the one moment a staged checklist becomes a real one.
    const wasNew = !form.id;
    const wasChecklist = form.doc_type === 'checklist';
    try {
      const result = await adminSaveDocument(form, token);
      if (!result?.success) throw new Error(result?.message || 'Could not save the document.');
      const documentId = result.id || form.id;
      // Keep editing the row that was just written, now carrying its id and version, so a second save updates it
      // rather than creating a duplicate.
      setForm((current) => ({
        ...current,
        id: documentId,
        row_version: result.row_version ?? current.row_version,
      }));

      if (wasNew && wasChecklist && stagedItems.length > 0) {
        const flushed = await flushStagedItems(documentId);
        if (flushed.failed > 0) {
          toast.warning(`Checklist created with ${flushed.saved} of ${flushed.saved + flushed.failed} items.`, {
            description: `${flushed.failed} could not be saved. Add them again from the page you are on.`,
          });
        } else {
          toast.success(`Checklist created with ${flushed.saved} item${flushed.saved === 1 ? '' : 's'}.`);
        }
      } else {
        toast.success(wasNew ? 'Document created.' : 'Document saved.');
      }

      await refresh();
      onDataChanged?.();
    } catch (err) {
      setError(err?.message || 'Could not save the document.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const target = pendingDelete;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      const result = await adminDeleteDocument(target.id, token);
      if (!result?.success) throw new Error(result?.message || 'Could not delete the document.');
      toast.success('Document deleted.');
      if (form.id === target.id) setForm(EMPTY_DOCUMENT_FORM);
      await refresh();
      onDataChanged?.();
    } catch (err) {
      // The refusal for a SIGNED document arrives here, and it is the useful case: it names the signature count
      // and says to unpublish instead.
      toast.error(err?.message || 'Could not delete the document.');
    } finally {
      setPendingDelete(null);
      setDeleting(false);
    }
  };

  const handleRenameFolder = async (event) => {
    event.preventDefault();
    const from = renaming.from.trim();
    const to = renaming.to.trim();
    if (!from) return;
    try {
      const result = await adminRenameDocumentFolder(from, to, token);
      if (!result?.success) throw new Error(result?.message || 'Could not rename the folder.');
      toast.success(
        result.renamed === 0
          ? 'That folder had no documents in it.'
          : `Moved ${result.renamed} document${result.renamed === 1 ? '' : 's'} to ${to || UNFILED_LABEL}.`
      );
      setRenaming({ from: '', to: '' });
      setForm((current) => (current.folder === from ? { ...current, folder: to } : current));
      await refresh();
      onDataChanged?.();
    } catch (err) {
      toast.error(err?.message || 'Could not rename the folder.');
    }
  };

  const isEditing = Boolean(form.id);

  // Item id -> label, so a signature row on a checklist names the item it is about instead of showing a bare id.
  const itemLabels = useMemo(() => {
    const map = new Map();
    items.forEach((item) => map.set(item.id, item.label));
    return map;
  }, [items]);

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 p-4 text-sm text-red-700 dark:text-red-200">
          {loadError}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-2">
          <FileText className="w-4 h-4 text-red-500 shrink-0" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Documents</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {rows.length} document{rows.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={() => openDocument('')}
            className="ml-auto flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-4 py-2 rounded-xl transition"
          >
            <Plus className="w-4 h-4" />
            New document
          </button>
        </div>

        {loadingDocument && (
          <div className="px-4 pt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Opening the document…
          </div>
        )}

        {loading ? (
          <div className="p-6 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading the documents…
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
            No documents yet. Create one with <strong>New document</strong>.
          </p>
        ) : (
          <div className="p-3">
            {groups.map((group) => (
              <div key={group.folder} className="mt-3 first:mt-0">
                <div className="flex items-center gap-2 px-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {group.folder}
                  </h4>
                  {group.folder !== UNFILED_LABEL && (
                    <button
                      type="button"
                      onClick={() => setRenaming({ from: group.folder, to: group.folder })}
                      title={`Rename or move the ${group.folder} folder`}
                      className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition"
                    >
                      <FolderInput className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {group.documents.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => openDocument(row.id)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm transition ${
                        form.id === row.id
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      {row.title}
                      {!row.is_published && (
                        <span className="text-xs opacity-80" title="Not visible to members">
                          · draft
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The editor: the fields a document owns - where it lives, who may read it, and its text. The preview
          inside the editor is the app's own renderer, so what is seen here is what members get. */}
      <form
        onSubmit={handleSave}
        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6 space-y-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {isEditing ? 'Edit document' : 'New document'}
            </h3>
            {isEditing && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {authorLabel({ author_user_id: form.author_user_id }, users) || 'Author not recorded'}
                {documentUpdatedLabel(form, timeFormat) ? ` · ${documentUpdatedLabel(form, timeFormat)}` : ''}
              </p>
            )}
          </div>
          {isEditing && (
            <button
              type="button"
              onClick={() => setPendingDelete({ id: form.id, title: form.title })}
              className="ml-auto flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400 hover:underline"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label htmlFor="document-title" className={labelClass}>
              Title
            </label>
            <input
              id="document-title"
              type="text"
              value={form.title}
              onChange={(event) => setField('title', event.target.value)}
              placeholder="Driver checklist"
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="document-folder" className={labelClass}>
              Folder
            </label>
            {/* Existing folders are offered, so the usual case is a choice rather than retyping a name exactly -
                a typo would quietly create a second folder. A new name is still allowed: that is how folders are
                made, because a folder here is a name rather than a record. */}
            <input
              id="document-folder"
              type="text"
              list="document-folder-options"
              value={form.folder}
              onChange={(event) => setField('folder', event.target.value)}
              placeholder="Unfiled"
              className={fieldClass}
            />
            <datalist id="document-folder-options">
              {folders
                .filter((folder) => folder !== UNFILED_LABEL)
                .map((folder) => (
                  <option key={folder} value={folder} />
                ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="document-type" className={labelClass}>
                Type
              </label>
              <select
                id="document-type"
                value={form.doc_type}
                onChange={(event) => setField('doc_type', event.target.value)}
                className={fieldClass}
              >
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === 'checklist' ? 'Checklist' : 'Document'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="document-order" className={labelClass}>
                Order
              </label>
              <input
                id="document-order"
                type="number"
                value={form.sort_order}
                onChange={(event) => setField('sort_order', Number(event.target.value) || 0)}
                className={fieldClass}
              />
            </div>
          </div>


          <div>
            <label htmlFor="document-rank" className={labelClass}>
              Minimum rank
            </label>
            <select
              id="document-rank"
              value={form.rank_id}
              onChange={(event) => setField('rank_id', event.target.value)}
              className={fieldClass}
            >
              <option value="">Everyone</option>
              {rankChoices.map((choice) => (
                <option key={choice.order} value={choice.id}>
                  {choice.label} and above
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col justify-end gap-2 text-sm text-slate-700 dark:text-slate-200">
            {[
              { key: 'is_published', label: 'Visible to members' },
              { key: 'is_sign_required', label: 'Members must sign this' },
            ].map((toggle) => (
              <label key={toggle.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(form[toggle.key])}
                  onChange={(event) => setField(toggle.key, event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-red-600 focus:ring-red-500"
                />
                {toggle.label}
              </label>
            ))}
          </div>
        </div>

        <MarkdownEditor
          value={form.content}
          onChange={(value) => setField('content', value)}
          label={form.doc_type === 'checklist' ? 'Instructions (items come in the checklist stage)' : 'Content'}
        />

        {error && (
          <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEditing ? 'Save changes' : 'Create document'}
          </button>
        </div>
      </form>

      {/* Renaming a folder rewrites the name on every document in it - one bulk write on the server. Leaving the
          target blank moves those documents to Unfiled, which is the only way to be rid of a folder, since a
          folder with no documents does not exist. */}

      {/* Checklist items. Their own card, because an item is a record rather than part of the document's text: a
          signature points at an item's id, so editing the wording keeps it attached to what was signed, and a
          signed item cannot be removed at all. One form serves adding and editing, so the two cannot drift. */}
      {form.doc_type === 'checklist' && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Checklist items</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {items.length} item{items.length === 1 ? '' : 's'}
              {stagedItems.length > 0 ? ` · ${stagedItems.length} not saved yet` : ''}
            </span>
          </div>

          {/* The panel is here for a checklist that has never been saved, too - that is the whole point of it. The
              items of a new checklist are held until the document exists, and written the moment it does, because
              making the author save first, reopen the document and start again is how this looked like it was
              missing altogether. */}
          {!isEditing && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Add the lines below now, then save this checklist: they are written as soon as it is created. Nothing is
              stored until then.
            </p>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Each item is signed on its own. Editing an item keeps its signatures attached to it; removing one is
            refused once anybody has signed it. Changing any item marks signatures taken earlier as
            &ldquo;before the last edit&rdquo;.
          </p>

          {items.length + stagedItems.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">This checklist has no items yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {[...items, ...stagedItems].map((item) => {
                const staged = !isEditing || String(item.id).startsWith('staged-');
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 py-2">
                    {item.section && (
                      <span className="rounded-full bg-slate-100 dark:bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {item.section}
                      </span>
                    )}
                    <span className="text-sm text-slate-700 dark:text-slate-200">{item.label}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">#{item.sort_order}</span>
                    {staged && (
                      <span className="rounded-full bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                        not saved
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setItemForm({
                          id: item.id,
                          label: item.label,
                          section: item.section,
                          sort_order: item.sort_order,
                        })
                      }
                      className="ml-auto text-xs font-medium text-slate-600 dark:text-slate-300 hover:underline"
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingItemRemoval(item)}
                      className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                    >
                      remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <form onSubmit={handleSaveItem} className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="item-label" className={labelClass}>
                  Item
                </label>
                <input
                  id="item-label"
                  type="text"
                  value={itemForm.label}
                  onChange={(event) => setItemForm((current) => ({ ...current, label: event.target.value }))}
                  placeholder="Check the tire pressure"
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="item-section" className={labelClass}>
                  Section
                </label>
                <input
                  id="item-section"
                  type="text"
                  value={itemForm.section}
                  onChange={(event) => setItemForm((current) => ({ ...current, section: event.target.value }))}
                  placeholder="Before leaving"
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="item-order" className={labelClass}>
                  Order
                </label>
                <input
                  id="item-order"
                  type="number"
                  value={itemForm.sort_order}
                  onChange={(event) =>
                    setItemForm((current) => ({ ...current, sort_order: Number(event.target.value) || 0 }))
                  }
                  className={fieldClass}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={savingItem}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-medium text-sm px-4 py-2 rounded-xl transition"
              >
                {savingItem ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {itemForm.id ? 'Save item' : 'Add item'}
              </button>
              {itemForm.id && (
                <button
                  type="button"
                  onClick={() => setItemForm(EMPTY_ITEM_FORM)}
                  className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:underline"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* The signature report. Below the editor on purpose: it answers "who has signed this", which is a question
          about the document rather than part of writing it. A stale signature is one taken before the latest edit
          and is called out, because a signature that appears to approve text nobody read is the one way this
          feature can mislead. */}
      {isEditing && form.is_sign_required && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Signatures</h3>
            {!loadingSignatures && !signaturesError && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {signatures.length} signature{signatures.length === 1 ? '' : 's'}
                {signatures.some((signature) => signature.stale)
                  ? ` · ${signatures.filter((signature) => signature.stale).length} from before the last edit`
                  : ''}
              </span>
            )}
          </div>

          {loadingSignatures && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading the signatures…
            </div>
          )}

          {!loadingSignatures && signaturesError && (
            <p className="text-sm font-medium text-red-600 dark:text-red-400">{signaturesError}</p>
          )}

          {!loadingSignatures && !signaturesError && signatures.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nobody has signed this document yet.</p>
          )}

          {!loadingSignatures && !signaturesError && signatures.length > 0 && (
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {signatures.map((signature) => (
                <li key={signature.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {memberLabel(signature.user_id)}
                  </span>
                  {signature.checklist_item_id !== '' && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {itemLabels.get(signature.checklist_item_id) || 'an item since removed'}
                    </span>
                  )}
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {signatureDateLabel(signature, timeFormat) || 'Signed'}
                  </span>
                  {signature.signature_role === 'verifier' && (
                    <span className="rounded-full bg-slate-100 dark:bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      verified by {memberLabel(signature.signed_by_user_id)}
                    </span>
                  )}
                  {signature.stale && (
                    <span className="rounded-full bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                      before the last edit
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingSignatureRemoval(signature)}
                    className="ml-auto text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Removing a signature is the only way one ever disappears, and it is recorded in the system log.
          </p>
        </div>
      )}

      {pendingItemRemoval && (
        <ConfirmModal
          title={`Remove “${pendingItemRemoval.label}”?`}
          message={
            !isEditing || String(pendingItemRemoval.id).startsWith('staged-')
              ? 'It has not been saved yet, so it simply disappears from the list.'
              : 'The item disappears from the checklist. If anybody has signed it the server refuses, because a signature must never outlive what it was about.'
          }
          confirmLabel={removingItem ? 'Removing…' : 'Remove item'}
          onConfirm={handleRemoveItem}
          onCancel={() => setPendingItemRemoval(null)}
        />
      )}

      {pendingSignatureRemoval && (
        <ConfirmModal
          title={`Remove the signature by ${memberLabel(pendingSignatureRemoval.user_id)}?`}
          message="They will be listed as needing to sign again. This is recorded in the system log."
          confirmLabel={removingSignature ? 'Removing…' : 'Remove signature'}
          onConfirm={handleRemoveSignature}
          onCancel={() => setPendingSignatureRemoval(null)}
        />
      )}

      {renaming.from && (
        <form
          onSubmit={handleRenameFolder}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6 space-y-3"
        >
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Folder &ldquo;{renaming.from}&rdquo;
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Renaming moves every document in it. Leave the new name blank to move them to {UNFILED_LABEL}.
          </p>
          <input
            type="text"
            value={renaming.to}
            onChange={(event) => setRenaming((current) => ({ ...current, to: event.target.value }))}
            placeholder={UNFILED_LABEL}
            aria-label="New folder name"
            className={fieldClass}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="bg-slate-700 hover:bg-slate-600 text-white font-medium text-sm px-4 py-2 rounded-xl transition"
            >
              Rename folder
            </button>
            <button
              type="button"
              onClick={() => setRenaming({ from: '', to: '' })}
              className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:underline"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {pendingDelete && (
        <ConfirmModal
          title={`Delete “${pendingDelete.title}”?`}
          message="This cannot be undone. A document that has been signed cannot be deleted at all — unpublish it instead."
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

    </div>
  );
}
