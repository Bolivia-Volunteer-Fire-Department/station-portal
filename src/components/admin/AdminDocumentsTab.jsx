import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FileText, FolderInput, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import {
  adminDeleteChecklistItem,
  adminDeleteDocument,
  adminFetchDocument,
  fetchDocumentSignatures,
  adminFetchDocuments,
  adminRemoveDocumentSignature,
  adminRenameDocumentFolder,
  adminReorderDocuments,
  adminSaveChecklistItem,
  adminSaveDocument,
} from '../../services/api';
import { toast } from '../../utils/toast';
import AdminChecklistVerification from './AdminChecklistVerification';
import AdminSignatureBackfill from './AdminSignatureBackfill';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import MarkdownEditor from '../MarkdownEditor';
import { authorLabel } from '../../utils/authorLabel';
import { unnamedLabel } from '../../utils/displayLabel';
import { parseRankOrder, rankLabel } from '../../utils/rankEligibility';
import { toDateKey } from '../../utils/scheduleDate';
import {
  DOCUMENT_TYPES,
  EMPTY_DOCUMENT_FORM,
  UNFILED_LABEL,
  checklistItemSortOrder,
  documentFolder,
  documentFolders,
  documentLifecycle,
  documentRequiresVerification,
  documentSaveProblem,
  documentToForm,
  documentUpdatedLabel,
  documentWindowLabel,
  editorChecklistItemRows,
  groupDocumentsByFolder,
  applyDocumentOrder,
  documentOrderSignature,
  pendingDocumentOrderPairs,
  savedDocumentOrderPairs,
  insertDocumentBefore,
  normalizeChecklistItemList,
  normalizeDocumentList,
  normalizeSignatureList,
  orderedFolderDocuments,
  reorderDocuments,
  reorderFolders,
  signatureDateLabel,
} from '../../utils/documents';
import { checklistSignatureEntries } from '../../utils/checklists';
import { clampPage, pageRangeLabel, pageSlice, totalPages } from '../../utils/pagination';

// How many signature rows the card shows at once.
//
// Smaller than the 20 a table uses, because this card sits INSIDE the edit form rather than being the page: on a
// checklist it fills up fast (every member who signed every item is a row) and it was the thing pushing the
// document's own fields off the screen.
const SIGNATURE_PAGE_SIZE = 10;

// The editor's form id. The modal's Save button lives in the toolbar, outside the <form>, and submits it through
// the HTML `form` attribute - so the fields keep their native behaviour (Enter in a text input, validation)
// while the button sits where it can be reached from the bottom of a long checklist.
const EDITOR_FORM_ID = 'document-editor-form';

// `sort_order` is TEXT here, and blank is a real answer - see `checklistItemSortOrder`. The default is blank, meaning
// "put it wherever the list says", which is what `EMPTY_ITEM_FORM` always meant; it just could not say so while the
// field held the number 0.
const EMPTY_ITEM_FORM = { id: '', label: '', section: '', sort_order: '' };

// The name of a GAP in the list - the space between two documents, or the end of a folder's run.
//
// A gap has no row to be identified by, so it is named after the two things that decide where it is: the folder it
// belongs to, and the document it comes BEFORE (blank for the gap after the last one). One string, so the element that
// shows the insertion bar and the handler that performs the drop cannot disagree about which gap is which - and the
// folder is part of it because the same document id appears in only one folder, while a blank anchor appears in all of
// them.
const gapKey = (folder, beforeId) => `${folder}|${beforeId}`;

// WHERE AN UNSAVED ORDER WAITS. Reordering is now "move as many rows as you like, then save once", so the moves have to
// survive the screen going away - and switching Administration tabs unmounts this one. sessionStorage rather than state
// because the draft has to outlive the unmount, and rather than localStorage because an order nobody saved is about this
// sitting, not about this station. The schedule board keeps its unsaved month the same way and for the same reason.
const ORDER_DRAFT_KEY = 'documents.order.draft';

// The stored draft, as pairs. Anything unreadable is no draft at all: a corrupted entry must not stop the tab opening,
// and forgetting where a row was put is a smaller failure than refusing to draw the library.
const readOrderDraft = () => {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ORDER_DRAFT_KEY) || 'null');
    return (Array.isArray(parsed) ? parsed : [])
      .map((pair) => ({ id: String((pair && pair.id) || ''), sort_order: Number.parseInt(pair && pair.sort_order, 10) }))
      .filter((pair) => pair.id !== '' && Number.isFinite(pair.sort_order));
  } catch {
    return [];
  }
};

// Today, once, for the window badges. The same value the schedule's own tab uses: a lifecycle label that changed
// while a page was open would be worse than one that is a moment stale.
const todayKeyValue = toDateKey(new Date());

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
export default function AdminDocumentsTab({
  token,
  ranks = [],
  users = [],
  timeFormat = '12',
  // The signed-in admin's id, so the verification view can leave their OWN checklist off the list: the server
  // refuses self-verification.
  currentUserId = '',
  // Two permissions open this tab (see roleAllowsTab). Managing documents is the editor below; verifying them is
  // the queue at the bottom. A role may have either, or both.
  canManageDocuments = false,
  canVerifyDocuments = false,
  // NOT CALLED, deliberately, and kept in the signature so the panel's prop list stays uniform: every save in this tab
  // already reloads the list it changed (`refresh()` / `loadSignatures`), and DOCUMENTS ARE NOT IN THE SIGN-IN PAYLOAD AT
  // ALL - so asking for it re-read eighteen collections, including every shift ever scheduled, to update a screen that
  // reads none of them. See verify-read-budget.
  // _onDataChanged: the Documents tab reloads its own lists and needs no refresh wave (see
  // verify-read-budget), so the prop is accepted but deliberately unused.
  onDataChanged: _onDataChanged,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(EMPTY_DOCUMENT_FORM);
  const [loadingDocument, setLoadingDocument] = useState(false);
  // Whether the editor is open. It used to be a card at the bottom of the tab, always there; now it is a modal
  // that only exists while it is being used, so the page behind it is just the list.
  const [editorOpen, setEditorOpen] = useState(false);
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
  // Which page of the signatures card is showing. Reset whenever the signatures are (re)loaded, because a reload
  // is a different list: page 4 of the previous one is not page 4 of this one.
  const [signaturePage, setSignaturePage] = useState(1);
  // The checklist items of the document being edited, and the item form. Items are their own records because a
  // signature points at an item's id: editing the wording keeps the id, so what somebody signed stays attached to
  // what they signed.
  const [items, setItems] = useState([]);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM_FORM);
  const [savingItem, setSavingItem] = useState(false);
  const [pendingItemRemoval, setPendingItemRemoval] = useState(null);
  // Dragging to reorder. `dragging` holds whichever thing was picked up - a document id or a folder name - and
  // `dragOver` is where the pointer currently is, so the row under it can look like the place the drop will land.
  // Both are cleared on drop and on drag end, so a drag that is abandoned (Escape, or dropped outside) leaves no
  // highlight behind.
  const [draggingDocumentId, setDraggingDocumentId] = useState('');
  const [dragOverDocumentId, setDragOverDocumentId] = useState('');
  // WHICH GAP a document is hovering over, by `gapKey` - see the note on it. Kept apart from `dragOverDocumentId`
  // because the two are different answers to "where would this land": one is a row, the other is the space beside it.
  const [dragOverInsert, setDragOverInsert] = useState('');
  const [draggingFolder, setDraggingFolder] = useState('');
  const [dragOverFolder, setDragOverFolder] = useState('');
  const [savingOrder, setSavingOrder] = useState(false);
  // THE ORDER AS IT WAS LAST SAVED, `id -> sort_order`, and the working copy the officer is building against it.
  //
  // Reordering is staged: every drop and every Move up / Move down changes `rows` locally, and nothing is written until
  // Save order. So the tab has to know two things at once - what the library looks like now (in `rows`, and therefore on
  // screen) and what is actually stored (`savedOrder`) - and the difference between them is both the button's reason to
  // exist and the exact pairs a save has to write. See `pendingDocumentOrderPairs`.
  const [savedOrder, setSavedOrder] = useState(() => new Map());
  // The pending pairs as of the last render, for `refresh` to read: a reload must not throw away an order the officer
  // has arranged but not saved. A ref rather than the state value because `refresh` is a callback that must not be
  // rebuilt every time the order changes.
  const pendingOrderRef = useRef([]);
  // Whether the stored draft has been looked at. It is read ONCE, on the first load, and applied to the rows that
  // arrive - reading it again later would resurrect a draft the officer had just discarded.
  const draftReadRef = useRef(false);

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
      const fresh = await loadRows();
      // A RELOAD IS NOT A REASON TO LOSE AN UNSAVED ORDER. Any save in this tab reloads the library, and so does the
      // first mount - and applying the raw answer would put every staged row back where the server has it, silently,
      // which is the same class of quiet loss the staging exists to avoid. So the working order is laid over the rows
      // that arrived: they carry the fresh contents, the officer's arrangement sits on top.
      //
      // On the FIRST load the pending order comes from sessionStorage instead, because the state is empty then by
      // definition - that is what makes the draft survive the tab being closed.
      const draft = draftReadRef.current ? pendingOrderRef.current : readOrderDraft();
      draftReadRef.current = true;
      // The snapshot is the rows as the SERVER sent them, taken before the draft is applied - so "what is stored" and
      // "what is on screen" stay two different, correct answers.
      setSavedOrder(documentOrderSignature(fresh));
      setRows(draft.length > 0 ? applyDocumentOrder(fresh, draft) : fresh);
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

  // Everything the editor shows about ONE document, put back to nothing - so the editor never carries a fact about the
  // last document into the next one.
  //
  // THE ITEMS ARE THE HALF THAT WAS MISSING, and they were the reported fault: after saving a checklist, "New document"
  // kept the items of the one just saved. Two things made that possible, and both are why this is a function rather
  // than a couple of lines at the call site. `items` is filled by `loadSignatures`, which a new document never calls -
  // it has no id to read - so nothing was ever going to overwrite them; and the item card draws `items` and
  // `stagedItems` together, so a leftover in either is drawn, with a count and a "no items yet" line that agree with
  // the wrong answer. `editorChecklistItemRows` now refuses to draw stored items for a document that has no id, so the
  // leak can no longer reach the screen - and this is the half that stops the state existing in the first place.
  //
  // CLEARED FOR AN EXISTING DOCUMENT TOO, and not only for a new one. The signatures and the items arrive from a
  // request, so between opening a checklist and its reply the PREVIOUS document's rows are still in state; and if that
  // request fails, nothing ever overwrites them, which leaves one document showing another's items beside its own
  // signatures. The pending removals go with them because each holds a whole row of the document being left behind.
  //
  // Nothing is written from this state - an item save needs `form.id`, and the create-time flush reads `stagedItems`,
  // which is exactly what gets emptied - so what is being fixed here is a screen that tells the truth, not a row that
  // lands in the wrong document.
  const resetEditorState = () => {
    setItems([]);
    setStagedItems([]);
    setItemForm(EMPTY_ITEM_FORM);
    setPendingItemRemoval(null);
    setSignatures([]);
    setSignaturesError('');
    setPendingSignatureRemoval(null);
    setSignaturePage(1);
    setError('');
  };

  const openDocument = async (id) => {
    // Opened before the fetch, so the modal appears immediately and shows its own spinner while the document
    // loads. The alternative - waiting for the request and then opening - is the pause this modal exists to
    // explain.
    setEditorOpen(true);
    // Before the branch below, deliberately: the new-document path returns from here, so anything reset after it
    // would never run for the one case that has no request to reset it for us.
    resetEditorState();
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
    // Back to the first page: this is a fresh list, and the pager is about the list, not about the card.
    setSignaturePage(1);
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

    // Staging: no document yet, so this is local. Left blank the order follows the list, ten apart, so an author who never
    // touches the Order field still gets the items in the order they typed them - but a 0 they typed is stored as 0.
    if (!form.id) {
      const entry = {
        id: itemForm.id,
        label: itemForm.label,
        section: itemForm.section,
        sort_order: checklistItemSortOrder(itemForm.sort_order, (stagedItems.length + 1) * 10),
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
          sort_order: checklistItemSortOrder(itemForm.sort_order),
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
    // Named in the toast, because a reader who has just removed one of two records about the same item should be
    // told which one went.
    const wasVerification = target.role === 'verifier';
    setRemovingSignature(true);
    try {
      const result = await adminRemoveDocumentSignature(target.id, token);
      if (!result?.success) throw new Error(result?.message || 'Could not remove the signature.');
      toast.success(wasVerification ? 'Verification removed.' : 'Signature removed.');
      await loadSignatures(form.id);
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
            // The staged entry already holds a number - `checklistItemSortOrder` resolved it when the item was typed - so
            // this only has to state it again, and it does so without reintroducing the blank-or-zero ambiguity.
            sort_order: checklistItemSortOrder(item.sort_order),
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

      // The write is confirmed, so the editor closes here - before the refresh below, which belongs to the page
      // behind it. That is what makes "only then should the modal close" true without making the reader watch a
      // list reload.
      setEditorOpen(false);

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
    } catch (err) {
      setError(err?.message || 'Could not save the document.');
    } finally {
      setSaving(false);
    }
  };

  // WHAT IS WAITING TO BE SAVED, which is the whole of the staged order: the rows whose number differs from the one
  // the library was last read with. Everything about the bar reads from this one list - how many changes there are, and
  // the exact pairs Save order sends - so the count can never disagree with what a save would write.
  //
  // DECLARED BEFORE THE DRAG HANDLERS BELOW rather than beside the item card, because they send it: a state value used
  // by a callback that is defined earlier reads as "accessed while being initialized", which is what the React
  // compiler's immutability rule means by it.
  const pendingOrder = useMemo(() => pendingDocumentOrderPairs(rows, savedOrder), [rows, savedOrder]);
  const orderDirty = pendingOrder.length > 0;

  // Kept in a ref for `refresh` to read, which is a callback and must not be rebuilt whenever the order changes. The
  // effect is what keeps it current: staging happens in an event handler, and by the time any later save reloads the
  // library React has long since committed and run this.
  useEffect(() => {
    pendingOrderRef.current = pendingOrder;
  }, [pendingOrder]);

  // The draft follows the pending pairs, so there is one description of "unsaved" rather than two. Writing it on every
  // change is what makes the order survive the tab being closed - and clearing it the moment the last pair is saved (or
  // the change is discarded) means a stale draft can never be restored over a library that is already correct.
  useEffect(() => {
    try {
      if (pendingOrder.length > 0) sessionStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify(pendingOrder));
      else sessionStorage.removeItem(ORDER_DRAFT_KEY);
    } catch {
      /* Storage unavailable - a private window, or it is full. The bar still says what is unsaved; only the survival
         across a tab switch is lost, which is not worth taking the screen down for. */
    }
  }, [pendingOrder]);

  // ---------------------------------------------------------------------------
  // Dragging to reorder
  // ---------------------------------------------------------------------------
  // The two ways a member of staff expects to order things: drag a DOCUMENT within its folder, and drag a FOLDER to
  // sit in front of another one. Neither writes anything itself - both ask a pure helper in utils/documents what
  // the numbers should become, then stage that. The helper is where the rules live (dropping up lands above, the
  // Unfiled shelf is pinned last, a document is never dragged into another folder by accident) and it is where
  // they are tested; a rule restated here would be a second version of it.
  //
  // A drag that ends where it started stages nothing, which is what makes a fumbled drag harmless.
  //
  // MAKE ALL THE CHANGES, THEN SAVE ONCE. Every drop and both Move up / Move down change `rows` and stop there; the
  // write happens when the officer presses Save order, and it is ONE request carrying every row that moved. Ordering a
  // shelf is a single job - "this goes first, that goes last, the other one in between" - and a request per nudge made
  // the officer wait on the network between each of them, half-saved if the third one failed, and unable to see how the
  // finished list looked before committing to it. The staged items on a new checklist already work this way, and so
  // does the schedule board, so this is the house pattern rather than a new idea.
  //
  // WHAT IS STAGED IS THE ORDER, NOT A COPY OF THE LIST. `rows` is the working copy the screen draws, and `savedOrder`
  // is the last thing the server confirmed; the pairs in between are the save (see `pendingDocumentOrderPairs`). That is
  // why a second drag builds on the first, and why dragging a row back where it was leaves nothing to save.
  //
  // A NOTE ON THE FAULT THIS REPLACED, because it is the reason the list is drawn the way it is: a reorder answers with
  // a COUNT (`{ moved }`), not with the library, and this used to redraw the list from `result.documents` - a field no
  // writer returns. `normalizeDocumentList(undefined)` is `[]`, so every drop emptied the list. Then, once that was
  // fixed by applying the pairs locally, nothing VISIBLY moved, because the list was drawn in the order the array
  // happened to be in rather than in `sort_order` - so the fix looked like it had not worked. Both halves are needed:
  // the pairs decide the order, and `documentsInFolder` draws that order.
  const stageOrder = useCallback(
    (pairs) => {
      if (pairs.length === 0 || savingOrder) return;
      setRows((current) => applyDocumentOrder(current, pairs));
    },
    [savingOrder]
  );

  // ONE REQUEST FOR EVERY ROW THAT MOVED. `pendingOrder` is already the difference between the screen and the server, so
  // there is nothing to work out here - and after it lands, the snapshot becomes the list the officer is looking at,
  // which is what makes the bar disappear in the same breath.
  const saveOrder = useCallback(async () => {
    const pairs = pendingOrder;
    if (pairs.length === 0 || savingOrder) return;
    setSavingOrder(true);
    try {
      const result = await adminReorderDocuments(pairs, token);
      if (!result?.success) throw new Error(result?.message || 'Could not save the new order.');
      setSavedOrder(documentOrderSignature(rows));
      toast.success(
        pairs.length === 1 ? 'Order saved.' : `Order saved, ${pairs.length} positions moved.`
      );
    } catch (err) {
      toast.error(err?.message || 'Could not save the new order.');
    } finally {
      setSavingOrder(false);
    }
  }, [pendingOrder, rows, savingOrder, token]);

  // Back to the stored order, with the snapshot rather than a read: the numbers that were saved are still in hand, so
  // undoing a change should not cost a request. Dragging rows around to find a layout and then thinking better of it is
  // the normal way to use this screen, not a failure to recover from.
  const discardOrder = useCallback(() => {
    if (savingOrder) return;
    setRows((current) => applyDocumentOrder(current, savedDocumentOrderPairs(savedOrder)));
  }, [savedOrder, savingOrder]);

  const startDocumentDrag = (event, row) => {
    if (savingOrder) {
      event.preventDefault();
      return;
    }
    setDraggingDocumentId(row.id);
    event.dataTransfer?.setData('text/plain', String(row.id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  };

  const dropOnDocument = (event, row) => {
    event.preventDefault();
    setDragOverDocumentId('');
    setDragOverInsert('');
    const movedId = draggingDocumentId || readDraggedId(event);
    setDraggingDocumentId('');
    if (!movedId || movedId === row.id) return;

    const moved = rows.find((candidate) => candidate.id === movedId);
    if (!moved) return;
    const pairs = reorderDocuments(rows, movedId, row.id);
    if (pairs.length === 0) {
      // The only way here is a drop across folders, which the helper refuses. Saying so is better than a row that
      // silently refuses to move.
      if (documentFolder(moved) !== documentFolder(row)) {
        toast.warning('A document cannot be dragged into another folder.', {
          description: 'Change its Folder field instead - dragging only sets the order.',
        });
      }
      return;
    }
    stageOrder(pairs);
  };

  // Dropping into a GAP - between two documents, or after the last one in a folder.
  //
  // This is the position the row drop cannot express, and it is the request that produced it: dropping ON a row lands
  // the document beside that row with the side chosen by the direction of the drag, so there was no way to say "between
  // these two" - and none at all to say "at the end" except by aiming at the last row from above. A gap names its own
  // position, so this asks the helper for the position it names.
  //
  // A drop that changes nothing sends nothing, which covers both of the ways this happens: the document is already
  // sitting in that gap (a fumbled drag, and the pull back is free), or it belongs to another folder - which a drag
  // never changes, and where the officer is told so rather than watching nothing happen.
  const dropOnInsert = (event, folder, beforeId) => {
    event.preventDefault();
    setDragOverInsert('');
    setDragOverDocumentId('');
    const movedId = draggingDocumentId || readDraggedId(event);
    setDraggingDocumentId('');
    if (!movedId) return;

    const moved = rows.find((candidate) => candidate.id === movedId);
    if (!moved) return;
    const pairs = insertDocumentBefore(rows, movedId, folder, beforeId);
    if (pairs.length === 0) {
      if (documentFolder(moved) !== folder) {
        toast.warning('A document cannot be dragged into another folder.', {
          description: 'Change its Folder field instead - dragging only sets the order.',
        });
      }
      return;
    }
    stageOrder(pairs);
  };

  const startFolderDrag = (event, folder) => {
    // Unfiled is not a folder anybody made: it is where documents with no folder are shown, and it is pinned last.
    if (savingOrder || folder === UNFILED_LABEL) {
      event.preventDefault();
      return;
    }
    setDraggingFolder(folder);
    event.dataTransfer?.setData('text/plain', String(folder));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  };

  const dropOnFolder = (event, folder) => {
    event.preventDefault();
    setDragOverFolder('');
    const movedFolder = draggingFolder || readDraggedFolder(event, rows);
    setDraggingFolder('');
    if (!movedFolder || movedFolder === folder) return;

    const pairs = reorderFolders(rows, movedFolder, folder);
    if (pairs.length === 0) return;
    stageOrder(pairs);
  };

  function readDraggedId(event) {
    try {
      return String(event.dataTransfer?.getData('text/plain') || '');
    } catch {
      return '';
    }
  }

  // A folder drag carries the name rather than an id, and the fallback has to tell the two apart: an id belongs to
  // a document, a name to a folder.
  function readDraggedFolder(event, list) {
    const carried = readDraggedId(event);
    if (!carried) return '';
    if (list.some((row) => row.id === carried)) return '';
    return list.some((row) => documentFolder(row) === carried) ? carried : '';
  }

  // The same move a drag performs, for a device that cannot drag: a touch screen fires no HTML5 drag events, and
  // "you cannot reorder on a tablet" is not a trade worth making for a tidier form. It uses the same helper, so the
  // buttons and a drag can never disagree about what "up one" means.
  const moveSelectedDocument = (direction) => {
    if (!form.id || savingOrder) return;
    const siblings = orderedFolderDocuments(rows, documentFolder(form));
    const index = siblings.findIndex((row) => row.id === form.id);
    const neighbour = index === -1 ? null : siblings[index + direction];
    if (!neighbour) return;
    const pairs = reorderDocuments(rows, form.id, neighbour.id);
    if (pairs.length === 0) return;
    stageOrder(pairs);
  };

  const selectedSiblings = form.id ? orderedFolderDocuments(rows, documentFolder(form)) : [];
  const selectedIndex = selectedSiblings.findIndex((row) => row.id === form.id);

  // THE GAPS BETWEEN THE DOCUMENTS, which is where a document goes to land BETWEEN two others.
  //
  // A thin element sitting where the two chips would otherwise be 8px apart, so the list looks exactly as it did and
  // the space between two documents has quietly become a target. It draws a bar only while a document is being carried
  // and only over itself: `aria-hidden` as well as invisible, because it is a place rather than a thing, and it carries
  // no text for a screen reader to announce.
  //
  // IT ONLY ANSWERS A DOCUMENT DRAG. A folder being carried has the folder HEADINGS as its targets, so the gaps do not
  // preventDefault for one - a dragover that is not prevented is not a drop target at all, which is what keeps a folder
  // drag from being caught by the space between two rows.
  const insertGap = (folder, beforeId) => {
    const key = gapKey(folder, beforeId);
    const active = dragOverInsert === key;
    return (
      <span
        key={`gap-${key}`}
        aria-hidden="true"
        // Two nested spans: the outer one is the TARGET - a full-height 8px of the list's width, so the gap is easy to
        // hit - and the inner one is the BAR, which is what makes it read as an insertion point rather than a gap that
        // happens to turn red.
        onDragOver={(event) => {
          if (!draggingDocumentId) return;
          event.preventDefault();
          // One highlight at a time: the row ring and the gap bar are two answers to the same question, and both lit
          // would say the document is landing in two places.
          setDragOverDocumentId('');
          setDragOverInsert(key);
        }}
        onDragLeave={() => setDragOverInsert((current) => (current === key ? '' : current))}
        onDrop={(event) => dropOnInsert(event, folder, beforeId)}
        className="flex h-8 w-2 shrink-0 items-center justify-center"
      >
        <span
          className={`h-full w-0.5 rounded-full transition-colors ${
            active ? 'bg-red-500' : 'bg-transparent'
          }`}
        />
      </span>
    );
  };

  const handleDelete = async () => {
    const target = pendingDelete;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      const result = await adminDeleteDocument(target.id, token);
      if (!result?.success) throw new Error(result?.message || 'Could not delete the document.');
      toast.success('Document deleted.');
      // The editor becomes a blank new-document form when the document it was showing is deleted, so it blanks
      // everything else the way opening a document does - otherwise the item card would still be drawing the rows of
      // the document that was just removed. See `resetEditorState`.
      if (form.id === target.id) {
        setForm(EMPTY_DOCUMENT_FORM);
        resetEditorState();
      }
      await refresh();
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
    } catch (err) {
      toast.error(err?.message || 'Could not rename the folder.');
    }
  };

  const isEditing = Boolean(form.id);

  // The item card's rows, and the two counts in its heading - all three from ONE answer, so they cannot disagree about
  // what the list holds. See `editorChecklistItemRows` for the rule, and for the reported fault that made stating it
  // in one place worth doing: the count, the "no items yet" line and the rows were each worked out separately from
  // `items.length + stagedItems.length`, so a leftover in `items` was wrong in all three at once.
  const itemRows = useMemo(
    () => editorChecklistItemRows(items, stagedItems, isEditing),
    [items, stagedItems, isEditing]
  );
  const stagedItemCount = itemRows.filter((row) => row.staged).length;
  const storedItemCount = itemRows.length - stagedItemCount;

  // Item id -> label, so a signature row on a checklist names the item it is about instead of showing a bare id.
  const itemLabels = useMemo(() => {
    const map = new Map();
    items.forEach((item) => map.set(item.id, item.label));
    return map;
  }, [items]);

  // The card's rows: one per member per item on a checklist, one per signature on anything else.
  //
  // Folding a member's item signature and its verification into one row is what stops every item being listed
  // twice - see checklistSignatureEntries, which is the same arithmetic the member-facing screen already shows. On
  // any other document there are no items and no verifications, so a row is a signature, as it always was.
  const signatureRows = useMemo(() => {
    if (form.doc_type === 'checklist') {
      return checklistSignatureEntries(items, signatures).map((entry) => ({
        key: entry.key,
        userId: entry.userId,
        itemLabel: entry.itemLabel,
        at: entry.signedAt,
        stale: entry.stale,
        verifications: entry.verifications,
        signatureId: entry.signatureId,
      }));
    }

    return signatures.map((signature) => ({
      key: signature.id,
      userId: signature.user_id,
      // A verifier row cannot normally exist on a document without items, but the sheet is hand-editable and a row
      // that is not shown is a row an administrator cannot remove.
      itemLabel: signature.checklist_item_id
        ? itemLabels.get(signature.checklist_item_id) || 'an item since removed'
        : '',
      at: signature.signed_at,
      stale: signature.stale,
      verifications: [],
      signatureId: signature.id,
      verifiedById: signature.signature_role === 'verifier' ? signature.signed_by_user_id : '',
    }));
  }, [form.doc_type, items, signatures, itemLabels]);

  // Paged, and clamped as well: removing the last row of the last page has to leave the card on the last page that
  // still has rows rather than on an empty one - the same rule the events and log tables follow.
  const signaturePageCount = totalPages(signatureRows.length, SIGNATURE_PAGE_SIZE);
  const currentSignaturePage = clampPage(signaturePage, signatureRows.length, SIGNATURE_PAGE_SIZE);
  const signatureRowsOnPage = useMemo(
    () => pageSlice(signatureRows, currentSignaturePage, SIGNATURE_PAGE_SIZE),
    [signatureRows, currentSignaturePage]
  );
  const staleSignatureCount = signatureRows.filter((row) => row.stale).length;
  // "signature" is the wrong word for a checklist row once they are folded: the row is one member's signature on
  // one item, and the count has to describe what is under it or the heading disagrees with the list.
  const signatureCountNoun = form.doc_type === 'checklist' ? 'signed item' : 'signature';

  // A role that may VERIFY but not MANAGE gets only the verification view. There is nothing here for it to edit,
  // and an editor whose every save the server would refuse is worse than no editor: it would look like a
  // permission problem one save at a time. This is an early return rather than a hidden section, so the two roles'
  // screens cannot drift apart - the same tab, two honest shapes.
  if (!canManageDocuments) {
    return (
      <div className="space-y-6">
        {canVerifyDocuments ? (
          <AdminChecklistVerification
            token={token}
            documents={rows}
            users={users}
            currentUserId={currentUserId}
            timeFormat={timeFormat}
          />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            You do not have permission to manage or verify documents.
          </p>
        )}
      </div>
    );
  }

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

        {/* No "opening" line here any more: the editor is a modal now, and it says so itself while the document
            loads. A line on the page underneath would be behind it and never read. */}

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
          <div className="p-3" aria-busy={savingOrder}>
            {/* The list is the drag surface: pick a row up and drop it where it should sit, and pick a folder
                heading up and drop it in front of another folder. There is no Order box to type into any more -
                the position is the position you see. */}
            {/* NOTHING IS WRITTEN UNTIL SAVE ORDER, so this is where the screen has to say what is waiting. The bar
                sits above the rows because it is about them, and it carries the two buttons rather than putting them
                in the toolbar: "save what I just arranged" belongs next to the arrangement, and the count beside it is
                the count of pairs a save would send (`pendingOrder`), not a separate tally that could drift from it.
                A folder drag and the Move up / Move down buttons stage through the same path, so all three are covered
                by the one bar. */}
            {savingOrder ? (
              <p className="px-1 pb-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving the new order…
                </span>
              </p>
            ) : orderDirty ? (
              <div className="mx-1 mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/40">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    {pendingOrder.length} unsaved change{pendingOrder.length === 1 ? '' : 's'} to the order
                  </span>
                  <span className="text-xs text-amber-800/80 dark:text-amber-300/80">
                    Kept if you switch tabs. Nothing moves in the library until you save.
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={discardOrder}
                      className="rounded-lg px-2.5 py-1 text-xs font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-200"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      onClick={saveOrder}
                      className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save order
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                  Keep dragging rows into place — save when the list reads the way you want it.
                </p>
              </div>
            ) : (
              <p className="px-1 pb-2 text-xs text-slate-500 dark:text-slate-400">
                Drag a document to reorder it, or a folder heading to move the whole folder — then press{' '}
                <strong className="font-semibold">Save order</strong>.
              </p>
            )}
            {groups.map((group) => (
              <div key={group.folder} className="mt-3 first:mt-0">
                <div
                  // Dropping onto a heading reorders FOLDERS. The heading itself is the target rather than the
                  // documents under it, so a folder can be put before an empty-looking one without aiming at a row.
                  onDragOver={(event) => {
                    if (!draggingFolder || draggingFolder === group.folder) return;
                    event.preventDefault();
                    setDragOverFolder(group.folder);
                  }}
                  onDragLeave={() => setDragOverFolder((current) => (current === group.folder ? '' : current))}
                  onDrop={(event) => dropOnFolder(event, group.folder)}
                  className={`flex items-center gap-2 rounded-lg px-1 py-1 transition ${
                    dragOverFolder === group.folder ? 'bg-red-50 dark:bg-red-950/40 ring-1 ring-red-400' : ''
                  } ${draggingFolder === group.folder ? 'opacity-50' : ''}`}
                >
                  <span
                    draggable={group.folder !== UNFILED_LABEL && !savingOrder}
                    onDragStart={(event) => startFolderDrag(event, group.folder)}
                    onDragEnd={() => {
                      setDraggingFolder('');
                      setDragOverFolder('');
                      // A folder drag never lights a gap, but a document drag that ENDED over this heading left one
                      // lit - and the drag can end anywhere on the page, so the tidy-up belongs here rather than only
                      // on the elements the drag started from.
                      setDragOverInsert('');
                    }}
                    title={
                      group.folder === UNFILED_LABEL
                        ? 'Unfiled is always shown last'
                        : `Drag to move the ${group.folder} folder`
                    }
                    className={`${
                      group.folder === UNFILED_LABEL ? '' : 'cursor-grab active:cursor-grabbing'
                    } text-slate-300 dark:text-slate-600`}
                  >
                    <FolderInput className="w-3.5 h-3.5" />
                  </span>
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
                {/* The chips close up against each other and the GAPS provide the spacing, so the space between two
                    documents is a target without the list looking any different from before. `items-center` and the
                    chip's own `gap-2` are untouched: the gap elements are 8px wide, which is what `gap-2` was. */}
                <div className="mt-1.5 flex flex-wrap items-center">
                  {group.documents.map((row) => (
                    // A keyed Fragment rather than a key on the gap alone: the gap and the chip it precedes are one
                    // unit of the list, and React has to be told which unit is which when the order changes.
                    <React.Fragment key={row.id}>
                      {insertGap(group.folder, row.id)}
                      <button
                        type="button"
                        onClick={() => openDocument(row.id)}
                        draggable={!savingOrder}
                        onDragStart={(event) => startDocumentDrag(event, row)}
                        // Only a DOCUMENT drag highlights a document row: a folder being carried has the headings as
                        // its targets, and marking rows under it would suggest a drop into that folder.
                        onDragOver={(event) => {
                          if (!draggingDocumentId || draggingDocumentId === row.id) return;
                          event.preventDefault();
                          // ...and the gap un-lights, for the same reason the gap lights: one answer at a time.
                          setDragOverInsert('');
                          setDragOverDocumentId(row.id);
                        }}
                        onDragLeave={() =>
                          setDragOverDocumentId((current) => (current === row.id ? '' : current))
                        }
                        onDrop={(event) => dropOnDocument(event, row)}
                        onDragEnd={() => {
                          setDraggingDocumentId('');
                          setDragOverDocumentId('');
                          setDragOverInsert('');
                        }}
                        title={`${row.title} — drag to reorder, or drop it in a gap to place it between two documents`}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm transition ${
                        form.id === row.id
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'
                      } ${savingOrder ? '' : 'cursor-grab active:cursor-grabbing'} ${
                        dragOverDocumentId === row.id ? 'ring-2 ring-red-400' : ''
                      } ${draggingDocumentId === row.id ? 'opacity-50' : ''}`}
                    >
                      {row.title}
                      {!row.is_published && (
                        <span className="text-xs opacity-80" title="Not visible to members">
                          · draft
                        </span>
                      )}
                      {/* A window that has closed is the one thing an administrator must be able to see at a glance,
                          because the document is otherwise indistinguishable from a live one in this list. */}
                      {documentLifecycle(row, todayKeyValue) === 'retired' && (
                        <span className="text-xs opacity-80" title={documentWindowLabel(row) || 'Retired'}>
                          · retired
                        </span>
                      )}
                      {documentLifecycle(row, todayKeyValue) === 'scheduled' && (
                        <span className="text-xs opacity-80" title={documentWindowLabel(row)}>
                          · scheduled
                        </span>
                      )}
                      </button>
                    </React.Fragment>
                  ))}
                  {/* ...AND ONE AFTER THE LAST DOCUMENT, which is the end of the run. Without it the only way to put a
                      document last was to aim at the final chip from above, and a document already at the end could not
                      be told where it was. */}
                  {insertGap(group.folder, '')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The editor, in a modal that takes most of the viewport. This is the one place in the tab with more than a
          few fields - and on a checklist it carries the items and the signature record as well - so it gets the
          screen rather than a card at the bottom of a page nobody scrolls to. Mounted only while it is open,
          which is why the page behind it is just the list, and why the form is not sitting there when all the
          reader wants is to read a document. */}
      {editorOpen && (
        // Both waits are this modal's: opening a document is a fetch, and saving is a write. Either way the reader
        // cannot type into a form whose document has not arrived, or into one that is being written.
        <ViewportModal
          title={isEditing ? 'Edit document' : 'New document'}
          subtitle={
            isEditing
              ? [
                  authorLabel({ author_user_id: form.author_user_id }, users) || 'Author not recorded',
                  documentUpdatedLabel(form, timeFormat),
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Not saved yet'
          }
          icon={<FileText className="h-4 w-4" />}
          formId={EDITOR_FORM_ID}
          saveLabel={isEditing ? 'Save changes' : 'Create document'}
          saving={saving}
          busy={saving || loadingDocument}
          busyLabel={loadingDocument ? 'Opening the document…' : 'Saving the document…'}
          onClose={() => setEditorOpen(false)}
          actions={
            isEditing ? (
              <button
                type="button"
                onClick={() => setPendingDelete({ id: form.id, title: form.title })}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            ) : null
          }
        >
          {/* The editor's own content: the fields a document owns - where it lives, who may read it, and its text. The
              preview is the app's own renderer, so what is seen here is what members get. Its title, its Delete
              button and its Save button are in the modal's toolbar above, so nothing here scrolls out of reach. */}
          <form id={EDITOR_FORM_ID} onSubmit={handleSave} className="space-y-4">
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
                    onChange={(event) => {
                      const nextType = event.target.value;
                      // Choosing Checklist turns the signature on with it, because a checklist IS its items being
                      // signed. Set here as well as on the server so the box the author is looking at matches what
                      // will be stored - a locked checkbox showing the wrong state is worse than no checkbox.
                      setForm((current) => ({
                        ...current,
                        doc_type: nextType,
                        is_sign_required: nextType === 'checklist' ? true : current.is_sign_required,
                        // ...and takes the SECOND signature off with it. A checklist's acknowledgment is its items,
                        // each confirmed on its own, so a document-level requirement cannot mean anything on one -
                        // and `storedRequiresVerification` refuses to store it anyway. Clearing it here keeps the form
                        // from holding a setting the save will silently drop.
                        requires_verification:
                          nextType === 'checklist' ? false : current.requires_verification,
                      }));
                    }}
                    className={fieldClass}
                  >
                    {DOCUMENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type === 'checklist'
                          ? 'Checklist'
                          : type === 'link'
                            ? 'Link'
                            : type === 'assessment'
                              ? 'Assessment'
                              : 'Document'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col justify-end gap-2">
                  {/* There is no Order box: position is set by dragging the row in the list above, which is the only
                      place the order is visible - a number typed here and a row sitting there would be two answers to
                      the same question, and the one on screen would win. The number is still carried on save, so an
                      untouched document keeps the position it has. */}
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Position in the list is set by <strong>dragging the rows</strong> above, and the folder by its place
                    on a document. Moves wait until you press <strong>Save order</strong>.
                  </p>
                  {/* The keyboard-and-tablet path to the same thing: a touch screen fires no drag events. */}
                  {isEditing && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => moveSelectedDocument(-1)}
                        disabled={savingOrder || selectedIndex <= 0}
                        className="flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-700"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                        Move up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSelectedDocument(1)}
                        disabled={savingOrder || selectedIndex === -1 || selectedIndex >= selectedSiblings.length - 1}
                        className="flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-700"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                        Move down
                      </button>
                      {/* THE BAR BEHIND THIS MODAL IS NOT VISIBLE FROM IN HERE, and Move up / Move down are inside it -
                          so without this the one path a touch screen can use would stage a move nobody could save, and
                          the button being grayed out while `savingOrder` would be the only feedback. Same pending list
                          as the bar, read from the same place, so the two can never disagree; the count and the button
                          appear together or not at all. */}
                      {orderDirty && (
                        <>
                          <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                            {pendingOrder.length} move{pendingOrder.length === 1 ? '' : 's'} not saved
                          </span>
                          <button
                            type="button"
                            onClick={saveOrder}
                            disabled={savingOrder}
                            className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
                          >
                            {savingOrder ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Save className="w-3.5 h-3.5" />
                            )}
                            Save order
                          </button>
                        </>
                      )}
                    </div>
                  )}
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
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(form.is_published)}
                    onChange={(event) => setField('is_published', event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-red-600 focus:ring-red-500"
                  />
                  Visible to members
                </label>

                {/* Locked ON for a checklist, because a checklist is signed line by line and that is the whole point of
                    the type: "you cannot create a checklist that does not accept checks". The server forces the flag
                    too, so this is the visible half of one rule rather than the rule itself. For every other type the
                    box is an ordinary choice. */}
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={form.doc_type === 'checklist' ? true : Boolean(form.is_sign_required)}
                    disabled={form.doc_type === 'checklist'}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setForm((current) => ({
                        ...current,
                        is_sign_required: on,
                        // THE TWO FLAGS ARE A PAIR. A document nobody signs has nothing to confirm, so turning the
                        // signature off takes the requirement with it rather than leaving a stored setting that
                        // describes nothing - and the payload builder would drop it on save anyway, which is a worse
                        // way to find out.
                        requires_verification: on ? current.requires_verification : false,
                      }));
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-red-600 focus:ring-red-500 disabled:opacity-60"
                  />
                  <span>
                    Members must sign this
                    {form.doc_type === 'checklist' && (
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                        Always on for a checklist: its items are what members sign. There is no separate signature for
                        the checklist itself.
                      </span>
                    )}
                  </span>
                </label>

                {/* THE SECOND SIGNATURE - the same arrangement a checklist gives its items, for a document that is
                    signed as a whole: the member acknowledges it, and somebody else confirms they looked. It appears
                    only where it can mean something. On a checklist the box is not offered at all (its items are what
                    get confirmed, one by one), and until "Members must sign this" is on it is DISABLED with the reason
                    rather than hidden - an author looking for the option is told why it is not available instead of
                    being left to wonder. The column is forced to match on save either way; see
                    `storedRequiresVerification` in utils/documents. */}
                {form.doc_type !== 'checklist' && (
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={documentRequiresVerification(form)}
                      disabled={!form.is_sign_required}
                      onChange={(event) => setField('requires_verification', event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-red-600 focus:ring-red-500 disabled:opacity-60"
                    />
                    <span>
                      A verifier must confirm the signature
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                        {form.is_sign_required
                          ? 'The member signs it, then somebody with the “Verify signatures” permission confirms they have read it. Their name and the date are recorded against the confirmation.'
                          : 'Turn on “Members must sign this” first — there is nothing to confirm until members sign.'}
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </div>

            {/* The window. Both dates blank is "no restriction" - forever, exactly how every document behaved before
                these columns existed. An end date in the past RETIRES the document: members stop seeing it and stop
                being asked to sign it, while the row, its items and every signature stay exactly where they are. */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="document-effective-date" className={labelClass}>
                  Effective Date <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="document-effective-date"
                  type="date"
                  value={form.effective_date}
                  onChange={(event) => setField('effective_date', event.target.value)}
                  className={fieldClass}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                  Members see it from this date. Blank means it is already live.
                </p>
              </div>
              <div>
                <label htmlFor="document-end-date" className={labelClass}>
                  End Date <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="document-end-date"
                  type="date"
                  value={form.end_date}
                  onChange={(event) => setField('end_date', event.target.value)}
                  className={fieldClass}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                  Retired after this date. Signatures already on it are kept.
                </p>
              </div>
            </div>

            {form.doc_type === 'link' ? (
              <div>
                <label htmlFor="document-link" className={labelClass}>
                  Address
                </label>
                <input
                  id="document-link"
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com/policy"
                  value={form.content}
                  onChange={(event) => setField('content', event.target.value)}
                  className={fieldClass}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                  Opened in a new tab from the reader, so a member keeps their place in the app. http:// or https:// only.
                </p>
              </div>
            ) : (
              <MarkdownEditor
                value={form.content}
                onChange={(value) => setField('content', value)}
                label={form.doc_type === 'checklist' ? 'Instructions (items come in the checklist stage)' : 'Content'}
              />
            )}

            {error && (
              <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}

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
                  {storedItemCount} item{storedItemCount === 1 ? '' : 's'}
                  {stagedItemCount > 0 ? ` · ${stagedItemCount} not saved yet` : ''}
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

              {itemRows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">This checklist has no items yet.</p>
              ) : (
                <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                  {itemRows.map(({ item, staged }) => {
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
                              // As TEXT, so the box shows the number it is and re-saving it keeps it: a 0 here used to
                              // be indistinguishable from an empty box and was renumbered on the next save.
                              sort_order: String(item.sort_order ?? ''),
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
                      // Kept as the TEXT that was typed. Parsing on every keystroke is what made `0` and blank the same
                      // value - and it also fought the author, turning a half-typed number into a different one under
                      // the cursor. `checklistItemSortOrder` reads it once, at the save, where the difference matters.
                      value={itemForm.sort_order}
                      onChange={(event) =>
                        setItemForm((current) => ({ ...current, sort_order: event.target.value }))
                      }
                      placeholder="Blank: after the last item"
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
                    {/* Counted from the ROWS, not from the signature records. On a checklist those differ - every
                        signed item is one row and every verification used to be another - and the heading has to
                        describe the list beneath it, or a checklist with three signed items claims eleven signatures. */}
                    {signatureRows.length} {signatureCountNoun}
                    {signatureRows.length === 1 ? '' : 's'}
                    {staleSignatureCount > 0
                      ? ` · ${staleSignatureCount} from before the last edit`
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

              {!loadingSignatures && !signaturesError && signatureRows.length === 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nobody has signed this document yet.</p>
              )}

              {!loadingSignatures && !signaturesError && signatureRows.length > 0 && (
                <>
                  <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                    {signatureRowsOnPage.map((row) => (
                      <li key={row.key} className="py-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            {memberLabel(row.userId)}
                          </span>
                          {row.itemLabel && (
                            <span className="text-xs text-slate-500 dark:text-slate-400">{row.itemLabel}</span>
                          )}
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {signatureDateLabel({ signed_at: row.at }, timeFormat) || 'Signed'}
                          </span>
                          {/* A verification is shown ON the row it belongs to, which is the whole point: the item is
                              listed once and "verified by" is a fact about it rather than a second line the reader has
                              to connect back to the first. */}
                          {row.verifiedById && (
                            <span className="rounded-full bg-slate-100 dark:bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              verified by {memberLabel(row.verifiedById)}
                            </span>
                          )}
                          {row.verifications.length > 0 && (
                            <span
                              className="rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400"
                              title={`Verified on ${row.verifications
                                .map((verification) => signatureDateLabel(verification, timeFormat) || 'an unknown date')
                                .join(', ')}`}
                            >
                              verified by{' '}
                              {row.verifications.map((verification) => memberLabel(verification.byUserId)).join(', ')}
                            </span>
                          )}
                          {row.stale && (
                            <span className="rounded-full bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                              before the last edit
                            </span>
                          )}

                          {/* One control per underlying record, and each is named. "remove" alone was ambiguous once
                              a row can carry both: a signature and a verification are separate rows in the sheet, so
                              removing one must not look like removing the other. */}
                          <span className="ml-auto flex flex-wrap items-center gap-x-3">
                            {row.verifications.map((verification) => (
                              <button
                                key={verification.id}
                                type="button"
                                onClick={() =>
                                  setPendingSignatureRemoval({
                                    id: verification.id,
                                    userId: row.userId,
                                    itemLabel: row.itemLabel,
                                    role: 'verifier',
                                    verifiedById: verification.byUserId,
                                  })
                                }
                                className="text-xs font-medium text-amber-500 dark:text-amber-400 hover:underline"
                              >
                                remove verification
                              </button>
                            ))}
                            {row.signatureId && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPendingSignatureRemoval({
                                    id: row.signatureId,
                                    userId: row.userId,
                                    itemLabel: row.itemLabel,
                                    role: 'member',
                                  })
                                }
                                className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                              >
                                remove signature
                              </button>
                            )}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* The card is the whole document's signature record, and on a checklist it grows with every member
                      who signs every item. The pager hides itself on a single page, as the events tables do. */}
                  {signaturePageCount > 1 && (
                    <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <span>{pageRangeLabel(signatureRows.length, currentSignaturePage, SIGNATURE_PAGE_SIZE)}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSignaturePage(
                              clampPage(currentSignaturePage - 1, signatureRows.length, SIGNATURE_PAGE_SIZE)
                            )
                          }
                          disabled={currentSignaturePage <= 1}
                          aria-label="Previous page"
                          className="rounded-lg p-1 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-slate-700"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="font-medium">
                          Page {currentSignaturePage} of {signaturePageCount}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setSignaturePage(
                              clampPage(currentSignaturePage + 1, signatureRows.length, SIGNATURE_PAGE_SIZE)
                            )
                          }
                          disabled={currentSignaturePage >= signaturePageCount}
                          aria-label="Next page"
                          className="rounded-lg p-1 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-slate-700"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
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
            // The two are separate records, so the message says which one goes and what stays: a verification can be
            // removed without touching the signature it confirms, and the reader should not have to guess.
            <ConfirmModal
              title={
                pendingSignatureRemoval.role === 'verifier'
                  ? `Remove the verification by ${memberLabel(pendingSignatureRemoval.verifiedById)}?`
                  : `Remove the signature by ${memberLabel(pendingSignatureRemoval.userId)}?`
              }
              message={
                pendingSignatureRemoval.role === 'verifier'
                  ? `${memberLabel(pendingSignatureRemoval.verifiedById)} confirmed ${memberLabel(
                      pendingSignatureRemoval.userId
                    )}${
                      pendingSignatureRemoval.itemLabel
                        ? ` on “${pendingSignatureRemoval.itemLabel}”`
                        : ''
                    }. Removing it leaves their signature in place, waiting to be verified again. This is recorded in the system log.`
                  : `${memberLabel(pendingSignatureRemoval.userId)} will be listed as needing to sign ${
                      pendingSignatureRemoval.itemLabel ? `“${pendingSignatureRemoval.itemLabel}”` : 'this document'
                    } again. This is recorded in the system log.`
              }
              confirmLabel={
                removingSignature
                  ? 'Removing…'
                  : pendingSignatureRemoval.role === 'verifier'
                    ? 'Remove verification'
                    : 'Remove signature'
              }
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

        </ViewportModal>
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

      {/* The verification queue, for a role that may confirm signatures as well as write documents. It sits at the
          BOTTOM because an editor's job here is the document; a verifier who cannot manage documents gets this on
          its own, at the top of the early return above. */}
      {canVerifyDocuments && (
        <AdminChecklistVerification
          token={token}
          documents={rows}
          users={users}
          currentUserId={currentUserId}
          timeFormat={timeFormat}
        />
      )}

      {/* Back-filling the paper files, for a role that manages documents - which is also what the write requires, so
          the panel is only drawn for a role that could use it rather than offering a save the server would refuse. It
          sits BELOW the verification queue deliberately: filling the history in is the one-off job somebody does when
          the station arrives, and confirming a member's items is the recurring one. */}
      {canManageDocuments && (
        <AdminSignatureBackfill
          token={token}
          documents={rows}
          users={users}
          currentUserId={currentUserId}
          timeFormat={timeFormat}
        />
      )}

    </div>
  );
}
