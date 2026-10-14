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

// Number of signature rows displayed per page in the document edit modal.
const SIGNATURE_PAGE_SIZE = 10;

// Form ID for the document editor.
const EDITOR_FORM_ID = 'document-editor-form';

// Default blank values for a checklist item.
const EMPTY_ITEM_FORM = { id: '', label: '', section: '', sort_order: '' };

// Unique key for drop gaps between documents during reordering.
const gapKey = (folder, beforeId) => `${folder}|${beforeId}`;

// Session storage key for saving document order drafts.
const ORDER_DRAFT_KEY = 'documents.order.draft';

// Read any unsaved document ordering draft from session storage.
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

// Today's date key for document status calculations.
const todayKeyValue = toDateKey(new Date());

// Increment document version number after saving changes.
const advanceRowVersion = (value) => String((Number.parseInt(value, 10) || 0) + 1);

const fieldClass =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500';

const labelClass = 'block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5';

// Admin tab for creating, editing, and organizing department documents and checklists.
export default function AdminDocumentsTab({
  token,
  ranks = [],
  users = [],
  timeFormat = '12',
  // Current user's ID (used to prevent self-verification).
  currentUserId = '',
  // Permissions for document management and checklist verification.
  canManageDocuments = false,
  canVerifyDocuments = false,
  documentVerificationCounts = {},
  // Unused callback kept for prop signature compatibility.
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
  // Signatures for the open document.
  const [signatures, setSignatures] = useState([]);
  const [loadingSignatures, setLoadingSignatures] = useState(false);
  const [signaturesError, setSignaturesError] = useState('');
  const [pendingSignatureRemoval, setPendingSignatureRemoval] = useState(null);
  const [removingSignature, setRemovingSignature] = useState(false);
  // Current page number for signatures list.
  const [signaturePage, setSignaturePage] = useState(1);
  // Checklist items and form state for the current document.
  const [items, setItems] = useState([]);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM_FORM);
  const [savingItem, setSavingItem] = useState(false);
  const [pendingItemRemoval, setPendingItemRemoval] = useState(null);
  // Drag-and-drop state for reordering documents and folders.
  const [draggingDocumentId, setDraggingDocumentId] = useState('');
  const [dragOverDocumentId, setDragOverDocumentId] = useState('');
  const [dragOverInsert, setDragOverInsert] = useState('');
  const [draggingFolder, setDraggingFolder] = useState('');
  const [dragOverFolder, setDragOverFolder] = useState('');
  const [savingOrder, setSavingOrder] = useState(false);
  // Stored document order map and pending draft order.
  const [savedOrder, setSavedOrder] = useState(() => new Map());
  const pendingOrderRef = useRef([]);
  const draftReadRef = useRef(false);

  const [removingItem, setRemovingItem] = useState(false);
  // Staged checklist items typed before a new document is saved.
  const [stagedItems, setStagedItems] = useState([]);

  const memberLabel = useCallback(
    (userId) => {
      const found = (Array.isArray(users) ? users : []).find((user) => String(user?.id) === String(userId));
      const name = found ? String(found.name || '').trim() : '';
      return name || unnamedLabel('member');
    },
    [users]
  );

  // Minimum required rank choices sorted from highest to lowest rank.
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

  // Refresh document list while preserving any unsaved order changes.
  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const fresh = await loadRows();
      const draft = draftReadRef.current ? pendingOrderRef.current : readOrderDraft();
      draftReadRef.current = true;
      setSavedOrder(documentOrderSignature(fresh));
      setRows(draft.length > 0 ? applyDocumentOrder(fresh, draft) : fresh);
    } catch (err) {
      setLoadError(err?.message || 'Could not load the documents.');
    } finally {
      setLoading(false);
    }
  }, [loadRows]);

  useEffect(() => {
    let canceled = false;
    loadRows()
      .then((fresh) => {
        if (canceled) return;
        const draft = draftReadRef.current ? pendingOrderRef.current : readOrderDraft();
        draftReadRef.current = true;
        setSavedOrder(documentOrderSignature(fresh));
        setRows(draft.length > 0 ? applyDocumentOrder(fresh, draft) : fresh);
      })
      .catch((err) => {
        if (!canceled) setLoadError(err?.message || 'Could not load the documents.');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [loadRows]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  // Reset editor state when switching or creating documents.
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

  // Open the document editor modal and fetch document data if editing an existing one.
  const openDocument = async (id) => {
    setEditorOpen(true);
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

  // Load signatures and checklist items for a document.
  const loadSignatures = async (documentId) => {
    setLoadingSignatures(true);
    setSignaturePage(1);
    try {
      const result = await fetchDocumentSignatures(documentId, token);
      if (!result?.success) throw new Error(result?.message || 'Could not load the signatures.');
      setSignatures(normalizeSignatureList(result.signatures));
      setItems(normalizeChecklistItemList(result.items));
    } catch (err) {
      setSignatures([]);
      setSignaturesError(err?.message || 'Could not load the signatures.');
    } finally {
      setLoadingSignatures(false);
    }
  };

  // Save a checklist item.
  const handleSaveItem = async (event) => {
    event.preventDefault();
    if (savingItem) return;
    if (!String(itemForm.label || '').trim()) {
      toast.error('An item needs a label.');
      return;
    }

    // Stage items locally before saving the document.
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
      // Refresh the documents list to reflect item changes.
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

    // Remove a staged item locally before save.
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
    // Check if this signature was a verifier confirmation.
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

  // Save all staged checklist items after creating a new document.
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
            // Preserve item sort order.
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
    // Track if document is newly created.
    const wasNew = !form.id;
    const wasChecklist = form.doc_type === 'checklist';
    try {
      const result = await adminSaveDocument(form, token);
      if (!result?.success) throw new Error(result?.message || 'Could not save the document.');
      const documentId = result.id || form.id;
      // Update form with assigned ID and version.
      setForm((current) => ({
        ...current,
        id: documentId,
        row_version: result.row_version ?? current.row_version,
      }));

      // Close the editor once saved.
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

  // Unsaved document order changes.
  const pendingOrder = useMemo(() => pendingDocumentOrderPairs(rows, savedOrder), [rows, savedOrder]);
  const orderDirty = pendingOrder.length > 0;

  // Keep pending order in sync.
  useEffect(() => {
    pendingOrderRef.current = pendingOrder;
  }, [pendingOrder]);

  // Persist pending order changes in session storage.
  useEffect(() => {
    try {
      if (pendingOrder.length > 0) sessionStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify(pendingOrder));
      else sessionStorage.removeItem(ORDER_DRAFT_KEY);
    } catch {
      // Ignore storage errors.
    }
  }, [pendingOrder]);

  // Drag-and-drop document reordering helpers.
  const stageOrder = useCallback(
    (pairs) => {
      if (pairs.length === 0 || savingOrder) return;
      setRows((current) => applyDocumentOrder(current, pairs));
    },
    [savingOrder]
  );

  // Save reordered document positions to database.
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

  // Discard unsaved reordering changes.
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
      // Documents cannot be dragged across different folders.
      if (documentFolder(moved) !== documentFolder(row)) {
        toast.warning('A document cannot be dragged into another folder.', {
          description: 'Change its Folder field instead - dragging only sets the order.',
        });
      }
      return;
    }
    stageOrder(pairs);
  };

  // Handle dropping a document into a gap between items.
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
    // Prevent moving the Unfiled section.
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

  // Extract folder name from dragged data.
  function readDraggedFolder(event, list) {
    const carried = readDraggedId(event);
    if (!carried) return '';
    if (list.some((row) => row.id === carried)) return '';
    return list.some((row) => documentFolder(row) === carried) ? carried : '';
  }

  // Move selected document up or down using buttons (for mobile or keyboard users).
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

  // Render a drop target bar between documents.
  const insertGap = (folder, beforeId) => {
    const key = gapKey(folder, beforeId);
    const active = dragOverInsert === key;
    return (
      <span
        key={`gap-${key}`}
        aria-hidden="true"
        onDragOver={(event) => {
          if (!draggingDocumentId) return;
          event.preventDefault();
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
      // Reset form if the deleted document was open.
      if (form.id === target.id) {
        setForm(EMPTY_DOCUMENT_FORM);
        resetEditorState();
      }
      await refresh();
    } catch (err) {
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

  // Checklist items to show in the editor.
  const itemRows = useMemo(
    () => editorChecklistItemRows(items, stagedItems, isEditing),
    [items, stagedItems, isEditing]
  );
  const stagedItemCount = itemRows.filter((row) => row.staged).length;
  const storedItemCount = itemRows.length - stagedItemCount;

  // Map checklist item IDs to their labels.
  const itemLabels = useMemo(() => {
    const map = new Map();
    items.forEach((item) => map.set(item.id, item.label));
    return map;
  }, [items]);

  // Combine signatures and verifications into display rows.
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

  // Paginate the signatures list.
  const signaturePageCount = totalPages(signatureRows.length, SIGNATURE_PAGE_SIZE);
  const currentSignaturePage = clampPage(signaturePage, signatureRows.length, SIGNATURE_PAGE_SIZE);
  const signatureRowsOnPage = useMemo(
    () => pageSlice(signatureRows, currentSignaturePage, SIGNATURE_PAGE_SIZE),
    [signatureRows, currentSignaturePage]
  );
  const staleSignatureCount = signatureRows.filter((row) => row.stale).length;
  // Label for count (signature vs signed item).
  const signatureCountNoun = form.doc_type === 'checklist' ? 'signed item' : 'signature';

  // If user can only verify but not manage, show the verification queue.
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
            documentVerificationCounts={documentVerificationCounts}
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
                  // Dropping onto a folder header reorders folders.
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
                      // Clear gap highlight when drag ends.
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
                {/* List of document buttons in this folder */}
                <div className="mt-1.5 flex flex-wrap items-center">
                  {group.documents.map((row) => (
                    // Gap insertion target and document button.
                    <React.Fragment key={row.id}>
                      {insertGap(group.folder, row.id)}
                      <button
                        type="button"
                        onClick={() => openDocument(row.id)}
                        draggable={!savingOrder}
                        onDragStart={(event) => startDocumentDrag(event, row)}
                        // Highlight document when dragging another document over it.
                        onDragOver={(event) => {
                          if (!draggingDocumentId || draggingDocumentId === row.id) return;
                          event.preventDefault();
                          // Clear gap highlight.
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
                  {/* Gap at the end of the folder */}
                  {insertGap(group.folder, '')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Document editor modal */}
      {editorOpen && (
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
          {/* Document fields and Markdown editor */}
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
                {/* Choose existing folder or type a new one */}
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
                      // Checklists always require signatures but don't need a document-level verification.
                      setForm((current) => ({
                        ...current,
                        doc_type: nextType,
                        is_sign_required: nextType === 'checklist' ? true : current.is_sign_required,
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
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Position in the list is set by <strong>dragging the rows</strong> above, and the folder by its place
                    on a document. Moves wait until you press <strong>Save order</strong>.
                  </p>
                  {/* Button-based ordering for touchscreens and keyboards */}
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
                      {/* Notice and button for unsaved order moves */}
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

                {/* Checklists always require signatures; other documents can toggle */}
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
                        // If signatures are off, clear the verification requirement.
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

                {/* Verification requirement for non-checklist documents */}
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
                      // Keep sort order as typed text.
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

          {/* Signatures collected for this document */}
          {isEditing && form.is_sign_required && (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Signatures</h3>
                {!loadingSignatures && !signaturesError && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {/* Total count of signed items or signatures */}
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
                          {/* Display verifier name */}
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

                          {/* Controls to remove verification or signature */}
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

                  {/* Signatures pagination */}
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
            // Modal to confirm removal of a signature or verification.
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

      {/* Checklist verification queue */}
      {canVerifyDocuments && (
        <AdminChecklistVerification
          token={token}
          documents={rows}
          users={users}
          currentUserId={currentUserId}
          timeFormat={timeFormat}
          documentVerificationCounts={documentVerificationCounts}
        />
      )}

      {/* Signature backfill tool */}
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
