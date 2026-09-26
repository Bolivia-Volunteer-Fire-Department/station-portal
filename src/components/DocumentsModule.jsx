import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  BookText,
  CheckCircle2,
  ExternalLink,
  FileText,
  Folder,
  ListChecks,
  Loader2,
  PenLine,
  Save,
  Search,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchDocument,
  fetchDocumentSignatures,
  fetchDocuments,
  signChecklistItems,
  signDocument,
  verifyChecklistItem,
  verifyChecklistRemaining,
} from '../services/api';
import { toast } from '../utils/toast';
import ConfirmModal from './ConfirmModal';
import Markdown from './Markdown';
import {
  documentFolder,
  documentLinkUrl,
  documentSignatureState,
  documentUpdatedLabel,
  documentsInFolder,
  filterDocuments,
  folderSummaries,
  isChecklist,
  isLink,
  normalizeChecklistItemList,
  normalizeDocument,
  normalizeDocumentList,
  normalizeSignature,
  normalizeSignatureList,
  outstandingSignatureDocuments,
  signatureDateLabel,
} from '../utils/documents';
import {
  checklistItemState,
  checklistProgressLabel,
  checklistSections,
  membersAwaitingVerification,
  verificationQueue,
} from '../utils/checklists';
import { unnamedLabel, userLabel } from '../utils/displayLabel';

// The Documents module, member-facing.
//
// Two panes, like the Help guides, because the shape of the problem is the same: a list of things down one side
// and one of them open beside it. What differs is where the content lives. The guides are markdown files bundled
// at build time; documents are rows in a sheet, so this screen reads the LIST when it opens and a BODY only when
// one is actually opened. That is what keeps it cheap however many documents a station accumulates, and it is
// also why searching covers titles and folders rather than the text.
//
// The server decides what the list contains: published, and at or above the member's rank. This screen never
// filters for access - it renders what it was given, so that rule lives in exactly one place.
// One checklist item, as the MEMBER reads it: a tick box, the label, and what has happened to it since.
//
// Extracted rather than inlined because the row carries four states at once - unticked, ticked, signed, verified
// - and the verification panel needs the same label rendering without the tick box. A row that had to be kept in
// step by hand in two places is how the two screens would end up disagreeing about what "verified" looks like.
//
// The WHOLE ROW is the button, not just the box. A 16px square is a fiddly target on a phone, and a row whose text
// swallows a tap reads as broken - which is exactly how it was reported: "clicking checklist items does nothing".
// The box is drawn as a span inside the button because a button inside a button is not valid and would swallow the
// click; the icon is what marks it, so nothing is lost by it not being one.
function ChecklistItemRow({ item, state, ticked, canTick, onToggle, footer }) {
  const marked = state.signed || ticked;
  const tickable = Boolean(onToggle) && canTick && !state.signed;

  const body = (
    <>
      {onToggle && (
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
            marked ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 dark:border-slate-600'
          } ${tickable ? 'group-hover:border-emerald-500' : 'opacity-70'}`}
        >
          {marked && <CheckCircle2 className="h-3.5 w-3.5" />}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-700 dark:text-slate-200">{item.label}</p>
        {state.stale && (
          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
            This item changed after it was signed, so the signature covers the earlier wording.
          </p>
        )}
        {footer}
      </div>

      <div className="shrink-0 text-right text-xs">
        {state.verified ? (
          <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
            <BadgeCheck className="h-3.5 w-3.5" />
            Verified
          </span>
        ) : state.signed ? (
          <span className="text-slate-500 dark:text-slate-400">Awaiting verification</span>
        ) : null}
      </div>
    </>
  );

  if (tickable) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggle(item, state)}
          aria-pressed={Boolean(marked)}
          aria-label={ticked ? `Untick ${item.label}` : `Tick ${item.label}`}
          className="group flex w-full items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-left transition hover:border-emerald-400 hover:bg-emerald-50/60 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/20"
        >
          {body}
        </button>
      </li>
    );
  }

  return (
    <li
      className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2"
      title={
        onToggle && state.signed
          ? 'You signed this item. Signatures cannot be removed.'
          : undefined
      }
    >
      {body}
    </li>
  );
}

// One folder in the browser: its name, how many documents are in it, and how many of those are waiting on THIS
// member. The second number is why the column is worth having - a folder you did not mean to open is exactly where
// the thing you have to sign is hiding.
//
// `compact` is the chip form for widths that do not get a folder column (below `lg`), so the same choice is one
// component rather than two lists that could drift apart.
function FolderOption({ entry, active, compact = false, onClick }) {
  const shape = compact
    ? 'shrink-0 rounded-full border px-3 py-1.5 text-xs'
    : 'w-full rounded-xl border px-3 py-2 text-sm';

  return (
    <button
      type="button"
      onClick={onClick}
      role={compact ? 'tab' : undefined}
      aria-selected={compact ? active : undefined}
      aria-current={compact ? undefined : active ? 'true' : undefined}
      className={`flex items-center gap-2 transition ${shape} ${
        active
          ? 'border-red-600 bg-red-600 font-semibold text-white'
          : 'border-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
      }`}
    >
      <Folder className="w-4 h-4 shrink-0" />
      <span className="min-w-0 truncate">{entry.folder}</span>
      <span
        className={`ml-auto shrink-0 text-[10px] tabular-nums ${
          active ? 'text-white/80' : 'text-slate-400 dark:text-slate-500'
        }`}
      >
        {entry.count}
      </span>
      {entry.outstanding > 0 && (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            active ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
          }`}
          title={`${entry.outstanding} waiting on your signature`}
        >
          {entry.outstanding}
        </span>
      )}
    </button>
  );
}

export default function DocumentsModule({
  token,
  currentUser,
  timeFormat = '12',
  users = [],
  canVerify = false,
}) {
  const [documents, setDocuments] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [onlyOutstanding, setOnlyOutstanding] = useState(false);
  // The folder the browser is showing. Empty means "not chosen yet", which resolves to the first folder that has
  // anything in it - so the module never opens on an empty column.
  const [folder, setFolder] = useState('');
  const [openId, setOpenId] = useState('');
  const [openDocument, setOpenDocument] = useState(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  // The document whose signature is being confirmed. Signing is a deliberate act, so it goes through the app's
  // own confirmation dialog rather than a single click on a row.
  const [pendingSignature, setPendingSignature] = useState(null);
  const [signing, setSigning] = useState(false);
  // Checklist items ticked but not yet saved, and the checklist being saved. Collected here and written in ONE
  // request, exactly as the Training module signs attendance: ticking several boxes and saving once is how the
  // screen is used, and a request per item would be 40 round trips for a 40-item checklist.
  const [pendingItemIds, setPendingItemIds] = useState(() => new Set());
  const [savingItems, setSavingItems] = useState(false);
  // The verification panel's own data, read only for the checklist on screen and only for somebody who may
  // verify. It is a second read rather than part of the document because the panel needs OTHER members'
  // signatures, which the member read never returns.
  const [panelItems, setPanelItems] = useState([]);
  const [panelSignatures, setPanelSignatures] = useState([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [verifyTargetId, setVerifyTargetId] = useState('');
  const [verifyingItemId, setVerifyingItemId] = useState('');
  const [verifyingAll, setVerifyingAll] = useState(false);

  const userId = currentUser?.id || '';

  const loadList = useCallback(async () => {
    const result = await fetchDocuments(token);
    if (!result?.success) throw new Error(result?.message || 'Could not load the documents.');
    return {
      documents: normalizeDocumentList(result.documents),
      signatures: normalizeSignatureList(result.signatures),
    };
  }, [token]);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setLoadError('');

    loadList()
      .then((loaded) => {
        if (canceled) return;
        setDocuments(loaded.documents);
        setSignatures(loaded.signatures);
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
  }, [loadList]);

  const openDocumentById = useCallback(
    async (id) => {
      setOpenId(id);
      setOpening(true);
      setOpenError('');
      try {
        const result = await fetchDocument(id, token);
        if (!result?.success) throw new Error(result?.message || 'That document could not be opened.');
        const loaded = normalizeDocument(result.document);
        // The member's OWN signature for this document travels with it, so the reader knows whether to ask for
        // one without a second request - and whether the one on file predates the last edit.
        loaded.signature = result.signature ? normalizeSignature(result.signature) : null;
        loaded.signature_stale = result.signature_stale === true;
        setOpenDocument(loaded);
      } catch (err) {
        setOpenDocument(null);
        setOpenError(err?.message || 'That document could not be opened.');
      } finally {
        setOpening(false);
      }
    },
    [token]
  );

  const documentIsChecklist = isChecklist(openDocument || {});
  const openDocumentId = openDocument?.id || '';

  // A checklist's items are always signable: the type IS the consent, and the server no longer consults the
  // document-level flag for items at all (it forces that flag on for a checklist anyway). Deriving it here means a
  // checklist created before that rule - one whose stored flag is still false - behaves like every other one,
  // rather than showing lines that refuse to be ticked.
  const itemsAreSignable = documentIsChecklist;

  // The address of an open link document, or '' when it is not usable as one. Empty is what makes the reader show
  // the "no usable address" note instead of an href built from whatever the cell happens to contain.
  const openLinkUrl = useMemo(() => documentLinkUrl(openDocument || {}), [openDocument]);

  // The verification panel's data: read when a checklist is open and the reader may verify, and cleared
  // otherwise so a stale list can never be shown against another document.
  useEffect(() => {
    if (!canVerify || !documentIsChecklist || !openDocumentId) {
      setPanelItems([]);
      setPanelSignatures([]);
      setPanelError('');
      setVerifyTargetId('');
      return undefined;
    }

    let canceled = false;
    setPanelLoading(true);
    setPanelError('');

    fetchDocumentSignatures(openDocumentId, token)
      .then((result) => {
        if (canceled) return;
        if (!result?.success) throw new Error(result?.message || 'Could not load the signatures.');
        setPanelItems(normalizeChecklistItemList(result.items));
        setPanelSignatures(normalizeSignatureList(result.signatures));
      })
      .catch((err) => {
        if (!canceled) setPanelError(err?.message || 'Could not load the signatures.');
      })
      .finally(() => {
        if (!canceled) setPanelLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [canVerify, documentIsChecklist, openDocumentId, token]);

  // Ticking an item that is already signed is refused here rather than by the server, and says why: signatures
  // are add-only, so the only thing that button could do is nothing.
  const togglePendingItem = (item, state) => {
    if (state.signed) {
      toast.warning('You have already signed this item. Signatures cannot be removed.', {
        description: 'If it is wrong, ask an administrator to correct it in the Documents report.',
      });
      return;
    }

    setPendingItemIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const handleSaveItems = async () => {
    const documentId = openDocument?.id || '';
    const itemIds = [...pendingItemIds];
    if (!documentId || itemIds.length === 0 || savingItems) return;

    setSavingItems(true);
    try {
      const result = await signChecklistItems(documentId, itemIds, token);
      if (!result?.success) throw new Error(result?.message || 'Could not record your signatures.');

      // The server answers with the member's own rows, so the screen shows what was actually written rather than
      // what was ticked - and a skipped item simply stays unsigned.
      setSignatures(normalizeSignatureList(result.signatures));
      setPendingItemIds(new Set());

      const skipped = Number(result.skipped) || 0;
      const signed = Number(result.signed) || 0;
      if (skipped > 0) {
        toast.warning(`Signed ${signed} item${signed === 1 ? '' : 's'}.`, {
          description: `${skipped} could not be signed - already signed, or no longer on this checklist.`,
        });
      } else {
        toast.success(`Signed ${signed} item${signed === 1 ? '' : 's'}. Thank you.`);
      }
    } catch (err) {
      toast.error(err?.message || 'Could not record your signatures.');
    } finally {
      setSavingItems(false);
    }
  };

  // Verifying one item of somebody else's checklist. The panel reloads from the server's answer rather than
  // guessing, so the rows and the counts can never disagree with the sheet.
  const handleVerifyItem = async (itemId) => {
    const documentId = openDocumentId;
    if (!documentId || !verifyTargetId || verifyingItemId) return;

    setVerifyingItemId(itemId);
    try {
      const result = await verifyChecklistItem(documentId, itemId, verifyTargetId, token);
      if (!result?.success) throw new Error(result?.message || 'Could not record the verification.');
      setPanelSignatures(normalizeSignatureList(result.signatures));
      toast.success(result.already_verified ? 'That was already verified.' : 'Verified.');
    } catch (err) {
      toast.error(err?.message || 'Could not record the verification.');
    } finally {
      setVerifyingItemId('');
    }
  };

  const handleVerifyRemaining = async () => {
    const documentId = openDocumentId;
    if (!documentId || !verifyTargetId || verifyingAll) return;

    setVerifyingAll(true);
    try {
      const result = await verifyChecklistRemaining(documentId, verifyTargetId, token);
      if (!result?.success) throw new Error(result?.message || 'Could not record the verifications.');
      setPanelSignatures(normalizeSignatureList(result.signatures));
      const verified = Number(result.verified) || 0;
      toast.success(
        result.already_verified || verified === 0
          ? 'There was nothing left to verify.'
          : `Verified ${verified} item${verified === 1 ? '' : 's'}.`
      );
    } catch (err) {
      toast.error(err?.message || 'Could not record the verifications.');
    } finally {
      setVerifyingAll(false);
    }
  };

  // Signing is a deliberate act, so it goes through a confirmation the member has to answer - and the answer is
  // sent to the server, which stamps the date and both identities. Nothing about who signed is decided here.
  const handleSign = async () => {
    const target = pendingSignature;
    if (!target || signing) return;
    setSigning(true);
    try {
      const result = await signDocument(target.id, token);
      if (!result?.success) throw new Error(result?.message || 'Could not record your signature.');
      setSignatures(normalizeSignatureList(result.signatures));
      setOpenDocument((current) =>
        current && current.id === target.id
          ? {
              ...current,
              signature: result.signature ? normalizeSignature(result.signature) : current.signature,
              signature_stale: false,
            }
          : current
      );
      toast.success(
        result.already_signed ? 'You had already signed this document.' : 'Signature recorded. Thank you.'
      );
    } catch (err) {
      toast.error(err?.message || 'Could not record your signature.');
    } finally {
      setPendingSignature(null);
      setSigning(false);
    }
  };

  const userLabelFor = useCallback(
    (userId) => {
      const found = (Array.isArray(users) ? users : []).find((user) => String(user.id) === String(userId));
      return found ? userLabel(found) : unnamedLabel('member');
    },
    [users]
  );

  // The open checklist, grouped for reading, plus the member's own progress through it.
  const openSections = useMemo(
    () => (documentIsChecklist && openDocument ? checklistSections(openDocument.items) : []),
    [documentIsChecklist, openDocument]
  );
  const openProgressLabel = useMemo(
    () => (openDocument ? checklistProgressLabel(openDocument.items, signatures, userId) : ''),
    [openDocument, signatures, userId]
  );
  const pendingItemCount = pendingItemIds.size;

  // The members a verifier has something to do about on this checklist, and the items for whichever one is
  // selected. Both are derived from the panel's own rows, never from the member's.
  const verifyQueue = useMemo(
    () =>
      canVerify && documentIsChecklist
        ? membersAwaitingVerification(panelItems, panelSignatures, userId)
        : [],
    [canVerify, documentIsChecklist, panelItems, panelSignatures, userId]
  );
  const verifyTargetQueue = useMemo(
    () => (verifyTargetId ? verificationQueue(panelItems, panelSignatures, verifyTargetId) : null),
    [panelItems, panelSignatures, verifyTargetId]
  );

  const outstanding = useMemo(
    () => outstandingSignatureDocuments(documents, signatures, userId),
    [documents, signatures, userId]
  );
  const visible = onlyOutstanding ? outstanding : documents;

  // A filter spans the whole library: searching, or asking for what needs signing, is a question about EVERY folder,
  // so while one is on the folder column stops deciding what the second column lists.
  const filtering = query.trim() !== '' || onlyOutstanding;
  const folders = useMemo(
    () => folderSummaries(visible, signatures, userId),
    [visible, signatures, userId]
  );
  const activeFolder = useMemo(() => {
    if (filtering) return '';
    if (folder && folders.some((entry) => entry.folder === folder)) return folder;
    return folders.length > 0 ? folders[0].folder : '';
  }, [filtering, folder, folders]);
  const listed = useMemo(
    () => (filtering ? filterDocuments(visible, query) : documentsInFolder(visible, activeFolder)),
    [filtering, visible, query, activeFolder]
  );

  const listIsEmpty = !loading && !loadError && documents.length === 0;
  const filterFoundNothing = !loading && !loadError && documents.length > 0 && listed.length === 0;

  // Closing the document puts the browser back the way it was: no selection, and no half-ticked checklist items
  // left over from a document the member is no longer looking at.
  const closeDocument = useCallback(() => {
    setOpenId('');
    setOpenDocument(null);
    setOpenError('');
    setPendingItemIds(new Set());
  }, []);

  // Choosing a folder is a deliberate move between shelves, so it also lets go of whatever was open - otherwise the
  // reader would keep showing a document from a folder the browser no longer has selected.
  const chooseFolder = useCallback(
    (name) => {
      setFolder(name);
      closeDocument();
    },
    [closeDocument]
  );

  return (
    <div className="space-y-4 md:h-full md:min-h-0 md:flex-1">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden md:h-full md:flex md:flex-col">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
          {/* The way back. Reading a document replaces the browser on a narrow screen, and on a wide one it is still
              the fastest way to drop what you are reading - so it lives in the card's own header, where it is
              reachable at every width, rather than at the top of the document it would scroll away from. */}
          {openId && (
            <button
              type="button"
              onClick={closeDocument}
              aria-label="Back to the list"
              title="Back to the list"
              className="flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <BookText className="w-4 h-4 text-red-500 shrink-0" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Documents</h3>
          {/* The one thing on this screen that is asking the member for something, so it is the one thing that
              gets to shout - and only while there is something to do, and only while the list it filters is on
              screen. A filter that changes a hidden list would look like a button that does nothing. */}
          {!openId && outstanding.length > 0 && (
            <button
              type="button"
              onClick={() => setOnlyOutstanding((current) => !current)}
              aria-pressed={onlyOutstanding}
              className={`ml-auto flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                onlyOutstanding
                  ? 'bg-amber-500 text-white'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60'
              }`}
            >
              <PenLine className="w-3.5 h-3.5" />
              {outstanding.length} to sign
            </button>
          )}
          {!openId && (
            <span className={`text-xs text-slate-500 dark:text-slate-400 ${outstanding.length > 0 ? '' : 'ml-auto'}`}>
              {onlyOutstanding ? `${visible.length} of ${documents.length}` : `${documents.length} document${documents.length === 1 ? '' : 's'}`}
            </span>
          )}
        </div>

        {loading && (
          <div className="p-6 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading the documents…
          </div>
        )}

        {!loading && loadError && (
          <div className="p-6">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">{loadError}</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Documents live in the station&rsquo;s spreadsheet, so this screen needs a connection.
            </p>
          </div>
        )}

        {listIsEmpty && (
          <div className="p-6">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              There are no documents yet. Somebody with the <strong>Manage documents</strong> permission can add
              them under Administration &rarr; Content &rarr; Documents.
            </p>
          </div>
        )}

        {/* Reading a document takes the WHOLE card: the folders and the list are put away rather than sitting beside
            it in a third of the width, and the back arrow in the header above is the way back to them. That is one
            layout for every screen size - a reader that shared the card at one width and owned it at another was
            two answers to the same question - which is why the reader below is the only child when something is
            open. */}
        {!loading && !loadError && documents.length > 0 && (
          <div
            className={
              openId
                ? 'md:flex-1 md:min-h-0 md:flex'
                : 'md:flex-1 md:min-h-0 md:grid md:grid-rows-1 md:grid-cols-[18rem_1fr] lg:grid-cols-[15rem_16rem_1fr]'
            }
          >
            {/* Column 1: the folders, with what is in each one. Hidden below `lg`, where the same choice is a row of
                chips above the document list - so a narrow screen shows one column at a time rather than three
                cramped ones. */}
            {!openId && (
              <div className="hidden lg:block border-r border-slate-200 dark:border-slate-700 lg:overflow-y-auto">
                <h4 className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Folders
                </h4>
                <div className="p-2 space-y-1">
                  {folders.map((entry) => (
                    <FolderOption
                      key={entry.folder}
                      entry={entry}
                      active={!filtering && entry.folder === activeFolder}
                      onClick={() => chooseFolder(entry.folder)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Column 2: the documents in the chosen folder - or the matches, when a filter is on. Gated the same way
                as the folder column: while a document is open this whole column is put away, at every width. */}
            {!openId && (
              <div className="border-b border-slate-200 dark:border-slate-700 lg:border-b-0 lg:border-r lg:overflow-y-auto">
              <div className="p-3">
                <label className="relative block">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search titles and folders"
                    aria-label="Search documents"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </label>

                {/* The folder choice again, as chips, for the widths that do not get a folder column. */}
                <div className="mt-3 flex gap-1 overflow-x-auto pb-1 lg:hidden" role="tablist" aria-label="Folders">
                  {folders.map((entry) => (
                    <FolderOption
                      key={entry.folder}
                      entry={entry}
                      compact
                      active={!filtering && entry.folder === activeFolder}
                      onClick={() => chooseFolder(entry.folder)}
                    />
                  ))}
                </div>

                <h4 className="mt-3 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {filtering ? 'All folders' : activeFolder}
                </h4>

                {filterFoundNothing ? (
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    {query.trim() ? (
                      <>No document matches &ldquo;{query}&rdquo;.</>
                    ) : (
                      <>Nothing in the library is waiting on you.</>
                    )}
                  </p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {listed.map((item) => {
                      const selected = item.id === openId;
                      const state = documentSignatureState(item, signatures, userId);
                      const checklist = isChecklist(item);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openDocumentById(item.id)}
                          className={`w-full text-left px-3 py-2 rounded-xl text-sm transition ${
                            selected
                              ? 'bg-red-600 text-white'
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            {/* A checklist is worth marking in the list: it is not read and put down, it is worked
                                through a line at a time, and that is the difference a member needs to see before
                                opening it. A link is marked for the same reason in reverse: nothing is stored here
                                to read, the row is a way out of the app, and that should not be a surprise. */}
                            {checklist ? (
                              <ListChecks className="w-4 h-4 shrink-0" title="Checklist" />
                            ) : isLink(item) ? (
                              <ExternalLink className="w-4 h-4 shrink-0" title="Opens an external link" />
                            ) : (
                              <FileText className="w-4 h-4 shrink-0" />
                            )}
                            <span className="min-w-0 truncate font-medium">{item.title}</span>
                            {/* When a filter is on, the list spans every folder - so each row says which one. */}
                            {filtering && (
                              <span
                                className={`shrink-0 truncate text-[10px] ${
                                  selected ? 'text-white/80' : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {documentFolder(item)}
                              </span>
                            )}
                            {state === 'signed' && (
                              <CheckCircle2
                                className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : 'text-emerald-500'}`}
                                title="Signed"
                              />
                            )}
                            {state === 'outstanding' && (
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                  filtering ? '' : 'ml-auto'
                                } ${
                                  selected
                                    ? 'bg-white/20 text-white'
                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                }`}
                              >
                                to sign
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              </div>
            )}

            {/* The document, and now the whole card's width when it is open. Nothing is fetched until one is chosen,
                which is the point of splitting the list from the body: a station with a hundred documents still
                opens in one small request. */}
            <div className="p-4 md:overflow-y-auto md:flex-1">
              {!openId && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Choose a document from the list to read it.
                </p>
              )}

              {openId && opening && (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Opening the document…
                </div>
              )}

              {openId && !opening && openError && (
                <p className="text-sm font-medium text-red-600 dark:text-red-400">{openError}</p>
              )}

              {openId && !opening && !openError && openDocument && (
                <article>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{openDocument.title}</h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {openDocument.folder || 'Unfiled'}
                    {documentUpdatedLabel(openDocument, timeFormat)
                      ? ` · ${documentUpdatedLabel(openDocument, timeFormat)}`
                      : ''}
                    {isChecklist(openDocument) ? ' · Checklist' : ''}
                    {isLink(openDocument) ? ' · Link' : ''}
                  </p>

                  {/* A link document has no body to render: its content IS an address, and the useful thing to do
                      with it is open it. The address is shown as well as linked, because a reader has to be able to
                      see where a click will take them. `rel="noreferrer"` and `target="_blank"` together are what
                      keep the external page from reaching back into this tab. */}
                  {isLink(openDocument) ? (
                    <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
                      {openLinkUrl ? (
                        <>
                          <a
                            href={openLinkUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-500"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Open in a new tab
                          </a>
                          <p className="mt-3 break-all text-xs text-slate-500 dark:text-slate-400">{openLinkUrl}</p>
                        </>
                      ) : (
                        /* A document whose address is not one this app will follow is reported as such rather than
                           offered as a dead or dangerous link. */
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                          This link has no usable address. An administrator needs to give it one that starts with
                          http:// or https://.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <Markdown markdown={openDocument.content} />
                    </div>
                  )}

                  {/* The signature block: what this document asks of the reader, and the answer already on file.
                      A signed document does not offer to sign again - signatures are not a toggle, and the button
                      that would do nothing is replaced by the sentence that explains why. */}
                  {/* A checklist is signed ITEM BY ITEM, so there is no "Sign this document" button on one: the
                      items below are the whole acknowledgment, and the server refuses a signature on a checklist
                      outright. Its `is_sign_required` flag is still true - that is what makes the items signable -
                      which is exactly why this cannot simply test the flag. */}
                  {openDocument.is_sign_required && !documentIsChecklist && (
                    <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
                      {openDocument.signature ? (
                        <>
                          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-4 h-4" />
                            {signatureDateLabel(openDocument.signature, timeFormat) || 'Signed'}
                          </p>
                          {openDocument.signature_stale && (
                            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                              This document has been edited since you signed it, so your signature covers the
                              earlier version. Read it again and ask an administrator if you are happy for it to
                              stand.
                            </p>
                          )}
                          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                            A signature cannot be withdrawn from here. Ask an administrator if it is wrong.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            This document needs your signature.
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Signing records that you have read and understood it, against your name and today&rsquo;s
                            date.
                          </p>
                          <button
                            type="button"
                            onClick={() => setPendingSignature(openDocument)}
                            className="mt-3 flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-4 py-2 rounded-xl transition shadow-lg shadow-red-600/20"
                          >
                            <PenLine className="w-4 h-4" />
                            Sign this document
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* A checklist's items, ticked and saved together. Signing an item is add-only, and a ticked
                      item that is already signed is refused with a reason rather than silently ignored. */}
                  {isChecklist(openDocument) && (
                    <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Items</h3>
                        {openProgressLabel && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">{openProgressLabel}</span>
                        )}
                        {itemsAreSignable && pendingItemCount > 0 && (
                          <button
                            type="button"
                            onClick={handleSaveItems}
                            disabled={savingItems}
                            className="ml-auto flex items-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-medium text-sm px-4 py-2 rounded-xl transition shadow-lg shadow-red-600/20"
                          >
                            {savingItems ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save {pendingItemCount} signature{pendingItemCount === 1 ? '' : 's'}
                          </button>
                        )}
                      </div>

                      {openDocument.items.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                          This checklist has no items yet.
                        </p>
                      ) : (
                        openSections.map((group) => (
                          <div key={group.section} className="mt-3 first:mt-2">
                            <h4 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              {group.section}
                            </h4>
                            <ul className="mt-1.5 space-y-1.5">
                              {group.items.map((item) => (
                                <ChecklistItemRow
                                  key={item.id}
                                  item={item}
                                  state={checklistItemState(item, signatures, userId)}
                                  ticked={pendingItemIds.has(item.id)}
                                  canTick={itemsAreSignable}
                                  onToggle={togglePendingItem}
                                />
                              ))}
                            </ul>
                          </div>
                        ))
                      )}

                      {/* There is no "this checklist asks for no signatures" case any more: a checklist's items are
                          always signable, the server forces the flag on for the type, and the item path no longer
                          consults it - so the explanation that used to live here would be explaining a state the app
                          can no longer reach. An administrator wanting a list that is only READ writes a Document,
                          not a Checklist. */}

                      {itemsAreSignable && pendingItemCount > 0 && (
                        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                          {pendingItemCount} item{pendingItemCount === 1 ? '' : 's'} ticked. Saving records them
                          against your name and today&rsquo;s date.
                        </p>
                      )}
                    </div>
                  )}

                  {/* The verification panel, for somebody whose role verifies checklists. It is here for the case
                      it is good at - the verifier is already reading this checklist - and the same job is offered
                      from the Administration module's Documents tab, where a verifier can pick the checklist and
                      then the member, which is the shape that answers "who is waiting on me". Both call the same
                      actions and the same pure helpers, so they cannot disagree about what is still outstanding.

                      The reader's OWN checklist is never offered: the server refuses self-verification, so listing
                      it would be listing a button that always fails. */}
                  {canVerify && isChecklist(openDocument) && (
                    <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                        <ShieldCheck className="w-4 h-4" />
                        Verification
                      </p>

                      {panelLoading && (
                        <p className="mt-2 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading signatures…
                        </p>
                      )}

                      {!panelLoading && panelError && (
                        <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">{panelError}</p>
                      )}

                      {!panelLoading && !panelError && verifyQueue.length === 0 && (
                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                          Nothing is waiting to be verified on this checklist.
                        </p>
                      )}

                      {!panelLoading && !panelError && verifyQueue.length > 0 && (
                        <>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Signed items nobody has confirmed yet. You cannot verify your own checklist.
                          </p>
                          <ul className="mt-3 space-y-1.5">
                            {verifyQueue.map((entry) => (
                              <li key={entry.userId}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setVerifyTargetId((current) => (current === entry.userId ? '' : entry.userId))
                                  }
                                  className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                                    verifyTargetId === entry.userId
                                      ? 'border-red-500 bg-white dark:bg-slate-800'
                                      : 'border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">
                                    {userLabelFor(entry.userId)}
                                  </span>
                                  <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">
                                    {entry.remaining.length} to verify
                                  </span>
                                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                                    {entry.signed} of {entry.total} signed
                                  </span>
                                </button>

                                {verifyTargetId === entry.userId && verifyTargetQueue && (
                                  <div className="mt-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-xs text-slate-500 dark:text-slate-400">
                                        {verifyTargetQueue.verified} of {verifyTargetQueue.signed} signed items verified
                                      </span>
                                      {verifyTargetQueue.remaining.length > 0 && (
                                        <button
                                          type="button"
                                          onClick={handleVerifyRemaining}
                                          disabled={verifyingAll}
                                          className="ml-auto flex items-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-medium text-xs px-3 py-1.5 rounded-xl transition"
                                        >
                                          {verifyingAll ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                          ) : (
                                            <BadgeCheck className="w-3.5 h-3.5" />
                                          )}
                                          Verify all {verifyTargetQueue.remaining.length}
                                        </button>
                                      )}
                                    </div>

                                    <ul className="mt-2 space-y-1.5">
                                      {panelItems.map((item) => {
                                        const itemState = checklistItemState(item, panelSignatures, entry.userId);
                                        return (
                                          <ChecklistItemRow
                                            key={item.id}
                                            item={item}
                                            state={itemState}
                                            ticked={false}
                                            canTick={false}
                                            footer={
                                              !itemState.signed ? (
                                                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                                  Not signed yet, so there is nothing to verify.
                                                </p>
                                              ) : !itemState.verified ? (
                                                <button
                                                  type="button"
                                                  onClick={() => handleVerifyItem(item.id)}
                                                  disabled={verifyingItemId === item.id}
                                                  className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-60"
                                                >
                                                  {verifyingItemId === item.id ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                  ) : (
                                                    <BadgeCheck className="w-3.5 h-3.5" />
                                                  )}
                                                  Verify this item
                                                </button>
                                              ) : (
                                                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                                  {itemState.verificationCount > 1
                                                    ? `Verified by ${itemState.verificationCount} people`
                                                    : 'Verified'}
                                                  {itemState.verifiedByUserId
                                                    ? ` · ${userLabelFor(itemState.verifiedByUserId)}`
                                                    : ''}
                                                </p>
                                              )
                                            }
                                          />
                                        );
                                      })}
                                    </ul>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </article>
              )}
            </div>
          </div>
        )}
      </div>

      {pendingSignature && (
        <ConfirmModal
          tone="default"
          title={`Sign “${pendingSignature.title}”?`}
          message="Your name and today's date are recorded against this document. A signature cannot be withdrawn by you — only an administrator can remove it."
          confirmLabel={signing ? 'Signing…' : 'I have read it — sign'}
          onConfirm={handleSign}
          onCancel={() => setPendingSignature(null)}
        />
      )}
    </div>
  );
}
