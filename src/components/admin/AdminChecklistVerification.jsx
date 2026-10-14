import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  fetchAdminDocumentVerificationSummary,
  fetchDocumentSignatures,
  verifyChecklistItem,
  verifyChecklistRemaining,
  verifyDocumentSignature,
} from '../../services/api';
import { toast } from '../../utils/toast';
import ConfirmModal from '../ConfirmModal';
import {
  documentRequiresVerification,
  membersAwaitingDocumentVerification,
  normalizeChecklistItemList,
  normalizeSignatureList,
  signatureDateLabel,
} from '../../utils/documents';
import {
  checklistProgressLabel,
  checklistVerifiedLabel,
  membersAwaitingVerification,
  verificationQueue,
} from '../../utils/checklists';
import { unnamedLabel, userLabel } from '../../utils/displayLabel';

const labelClass = 'block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5';
const fieldClass =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500';

// Verification panel: review and confirm checklist items or documents signed by members.
function AdminChecklistVerification({
  token,
  documents = [],
  users = [],
  currentUserId = '',
  timeFormat = '12',
  documentVerificationCounts = {},
}) {
  const [requestedListId, setRequestedListId] = useState('');
  const [items, setItems] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openMemberId, setOpenMemberId] = useState('');
  const [verifyingItemId, setVerifyingItemId] = useState('');
  const [verifyingMemberId, setVerifyingMemberId] = useState('');
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [showingVerifiedFor, setShowingVerifiedFor] = useState('');
  const [pendingCounts, setPendingCounts] = useState(documentVerificationCounts || {});
  const [summaryLoading, setSummaryLoading] = useState(
    !(documentVerificationCounts && Object.keys(documentVerificationCounts).length > 0)
  );

  useEffect(() => {
    if (documentVerificationCounts && Object.keys(documentVerificationCounts).length > 0) {
      setPendingCounts((prev) => ({ ...prev, ...documentVerificationCounts }));
      setSummaryLoading(false);
    }
  }, [documentVerificationCounts]);

  const refreshSummary = useCallback(async (candidateDocs = null) => {
    try {
      const summary = await fetchAdminDocumentVerificationSummary(candidateDocs);
      setPendingCounts(summary.byDocument || {});
    } catch (err) {
      console.warn('[verification] could not load verification summary', err);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // Documents or checklists eligible for verification.
  const verifiable = useMemo(
    () =>
      (Array.isArray(documents) ? documents : []).filter(
        (row) => row.doc_type === 'checklist' || documentRequiresVerification(row)
      ),
    [documents]
  );

  useEffect(() => {
    refreshSummary(verifiable.length > 0 ? verifiable : null);
  }, [refreshSummary, verifiable]);

  // When summary resolves and a document with pending items exists, default requestedListId to it if the user hasn't selected one
  useEffect(() => {
    if (!requestedListId && verifiable.length > 0) {
      const firstPending = verifiable.find((row) => (pendingCounts[row.id] || 0) > 0);
      if (firstPending) {
        setRequestedListId(firstPending.id);
      }
    }
  }, [verifiable, pendingCounts, requestedListId]);

  // Pick the requested document, or default to the first one with pending items, or the first available.
  const activeListId = useMemo(() => {
    if (requestedListId && verifiable.some((row) => row.id === requestedListId)) return requestedListId;
    const pendingDoc = verifiable.find((row) => (pendingCounts[row.id] || 0) > 0);
    if (pendingDoc) return pendingDoc.id;
    if (summaryLoading) return '';
    return verifiable.length > 0 ? verifiable[0].id : '';
  }, [verifiable, requestedListId, pendingCounts, summaryLoading]);

  const activeDocument = useMemo(
    () => verifiable.find((row) => row.id === activeListId) || null,
    [verifiable, activeListId]
  );

  // Check whether the active document is a checklist.
  const isChecklistTarget = String(activeDocument?.doc_type || '').trim().toLowerCase() === 'checklist';

  const loadSignatures = useCallback(
    async (documentId) => {
      if (!documentId) {
        setItems([]);
        setSignatures([]);
        setError('');
        return;
      }

      setLoading(true);
      setError('');
      try {
        const result = await fetchDocumentSignatures(documentId, token);
        if (!result?.success) throw new Error(result?.message || 'Could not load the signatures.');
        setItems(normalizeChecklistItemList(result.items));
        setSignatures(normalizeSignatureList(result.signatures));
      } catch (err) {
        setItems([]);
        setSignatures([]);
        setError(err?.message || 'Could not load the signatures.');
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  // Reload signatures when the chosen document changes.
  useEffect(() => {
    setOpenMemberId('');
    loadSignatures(activeListId);
  }, [activeListId, loadSignatures]);

  // Find members waiting for verification on this document.
  const waiting = useMemo(
    () =>
      isChecklistTarget
        ? membersAwaitingVerification(items, signatures, currentUserId)
        : membersAwaitingDocumentVerification(activeDocument || {}, signatures, currentUserId),
    [isChecklistTarget, activeDocument, items, signatures, currentUserId]
  );

  const activePendingCount = useMemo(() => {
    if (!waiting) return 0;
    return isChecklistTarget
      ? waiting.reduce((sum, entry) => sum + (entry.remaining ? entry.remaining.length : 0), 0)
      : waiting.length;
  }, [waiting, isChecklistTarget]);

  // Keep pendingCounts for the active document updated once its signatures load
  useEffect(() => {
    if (!activeListId || loading) return;
    setPendingCounts((prev) => {
      if (prev[activeListId] === activePendingCount) return prev;
      return { ...prev, [activeListId]: activePendingCount };
    });
  }, [activeListId, activePendingCount, loading]);

  // Determine why the queue is empty so we can show a helpful explanation.
  const emptyReason = useMemo(() => {
    if (isChecklistTarget && items.length === 0) return 'no-items';

    const wantedVerifier = String(currentUserId || '').trim();
    const signed = isChecklistTarget
      ? signatures.filter(
          (signature) =>
            signature.signature_role === 'member' &&
            signature.checklist_item_id !== '' &&
            items.some((item) => item.id === signature.checklist_item_id)
        )
      : signatures.filter(
          (signature) => signature.signature_role === 'member' && signature.checklist_item_id === ''
        );
    if (signed.length === 0) return 'nothing-signed';
    if (wantedVerifier && signed.every((signature) => signature.user_id === wantedVerifier)) return 'only-yours';
    return 'all-verified';
  }, [isChecklistTarget, items, signatures, currentUserId]);

  const openMemberQueue = useMemo(
    () => (openMemberId ? verificationQueue(items, signatures, openMemberId) : null),
    [items, signatures, openMemberId]
  );

  // Verify an individual checklist item.
  const handleVerifyItem = async (itemId) => {
    if (!activeListId || !openMemberId || verifyingItemId) return;

    setVerifyingItemId(itemId);
    try {
      const result = await verifyChecklistItem(activeListId, itemId, openMemberId, token);
      if (!result?.success) throw new Error(result?.message || 'Could not record the verification.');
      setSignatures(normalizeSignatureList(result.signatures));
      toast.success(result.already_verified ? 'That was already verified.' : 'Verified.');
      refreshSummary(verifiable);
    } catch (err) {
      toast.error(err?.message || 'Could not record the verification.');
    } finally {
      setVerifyingItemId('');
    }
  };

  const handleVerifyRemaining = async () => {
    if (!activeListId || !openMemberId || verifyingAll) return;

    setConfirmingAll(false);
    setVerifyingAll(true);
    try {
      const result = await verifyChecklistRemaining(activeListId, openMemberId, token);
      if (!result?.success) throw new Error(result?.message || 'Could not record the verifications.');
      setSignatures(normalizeSignatureList(result.signatures));
      const verified = Number(result.verified) || 0;
      toast.success(
        result.already_verified || verified === 0
          ? 'There was nothing left to verify.'
          : `Verified ${verified} item${verified === 1 ? '' : 's'}.`
      );
      refreshSummary(verifiable);
    } catch (err) {
      toast.error(err?.message || 'Could not record the verifications.');
    } finally {
      setVerifyingAll(false);
    }
  };

  // Verify a whole-document signature.
  const handleVerifyDocument = async (memberId) => {
    if (!activeListId || verifyingMemberId) return;

    setVerifyingMemberId(memberId);
    try {
      const result = await verifyDocumentSignature(activeListId, memberId, token);
      if (!result?.success) throw new Error(result?.message || 'Could not record the confirmation.');
      setSignatures(normalizeSignatureList(result.signatures));
      toast.success(result.already_verified ? 'That was already confirmed.' : 'Signature confirmed.');
      refreshSummary(verifiable);
    } catch (err) {
      toast.error(err?.message || 'Could not record the confirmation.');
    } finally {
      setVerifyingMemberId('');
    }
  };

  // Look up user display name by ID.
  const memberName = (userId) => {
    const user = users.find((row) => String(row.id) === String(userId));
    return user ? userLabel(user) : unnamedLabel(userId);
  };

  // Look up the signature for a specific checklist item.
  const signatureFor = (itemId) =>
    signatures.find(
      (signature) => signature.checklist_item_id === itemId && signature.user_id === openMemberId
    );

  const documentsNeedingVerification = useMemo(
    () => verifiable.filter((row) => (pendingCounts[row.id] || 0) > 0),
    [verifiable, pendingCounts]
  );

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Verify signatures</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Confirm what another member has signed: the items of a checklist, or a document whose signature the author
            asked to have checked. Nobody can verify their own work.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (activeListId) loadSignatures(activeListId);
            refreshSummary(verifiable);
          }}
          disabled={loading || summaryLoading}
          className="ml-auto flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
        >
          {loading || summaryLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {verifiable.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nothing is asking for a second signature yet. A checklist appears here once it has items to sign, and a
          document once its author ticks <strong>A verifier must confirm the signature</strong>.
        </p>
      ) : (
        <>
          {documentsNeedingVerification.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-950 dark:text-amber-200">
                  Documents awaiting verification ({documentsNeedingVerification.length})
                </span>
                <span className="text-[11px] text-amber-700 dark:text-amber-400">
                  Click to open
                </span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {documentsNeedingVerification.map((row) => {
                  const count = pendingCounts[row.id] || 0;
                  const isSelected = row.id === activeListId;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setRequestedListId(row.id)}
                      className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        isSelected
                          ? 'bg-amber-500 text-slate-950 shadow-sm ring-2 ring-amber-400'
                          : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-amber-300 dark:border-amber-800/80 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                      }`}
                    >
                      <span>{row.title}</span>
                      <span
                        className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                          isSelected ? 'bg-slate-950 text-white' : 'bg-amber-400 text-amber-950'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="verification-checklist" className={labelClass}>
              Checklist or document
            </label>
            <select
              id="verification-checklist"
              value={activeListId}
              onChange={(event) => setRequestedListId(event.target.value)}
              className={fieldClass}
              disabled={summaryLoading && !activeListId}
            >
              {summaryLoading && !activeListId && (
                <option value="">Checking for pending verifications…</option>
              )}
              {documentsNeedingVerification.length > 0 ? (
                <>
                  <optgroup label={`Awaiting verification (${documentsNeedingVerification.length})`}>
                    {documentsNeedingVerification.map((row) => {
                      const count = pendingCounts[row.id] || 0;
                      return (
                        <option key={row.id} value={row.id}>
                          {`● [${count} waiting] ${row.title}${row.folder ? ` — ${row.folder}` : ''}`}
                        </option>
                      );
                    })}
                  </optgroup>
                  <optgroup label="Other documents & checklists">
                    {verifiable
                      .filter((row) => !(pendingCounts[row.id] > 0))
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.title}
                          {row.folder ? ` — ${row.folder}` : ''}
                          {String(row.doc_type || '') === 'checklist'
                            ? row.item_count > 0
                              ? ` (${row.item_count} item${row.item_count === 1 ? '' : 's'})`
                              : ' (no items yet)'
                            : ' (signature confirmed as a whole)'}
                        </option>
                      ))}
                  </optgroup>
                </>
              ) : (
                verifiable.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                    {row.folder ? ` — ${row.folder}` : ''}
                    {String(row.doc_type || '') === 'checklist'
                      ? row.item_count > 0
                        ? ` (${row.item_count} item${row.item_count === 1 ? '' : 's'})`
                        : ' (no items yet)'
                      : ' (signature confirmed as a whole)'}
                  </option>
                ))
              )}
            </select>
          </div>

          {error && (
            <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          {!error && summaryLoading && !activeListId && (
            <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking for pending verifications…
            </p>
          )}

          {!error && loading && items.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading signatures…
            </p>
          )}

          {!error && !loading && !summaryLoading && waiting.length === 0 && (
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {emptyReason === 'no-items' && (
                <p>
                  This checklist has no items yet, so there is nothing for a member to sign or for you to confirm.
                  Add them under <strong>Checklist items</strong> above.
                </p>
              )}
              {emptyReason === 'nothing-signed' &&
                (isChecklistTarget ? (
                  <p>
                    Nobody has signed any items on this checklist yet. A member&rsquo;s ticked items appear here once
                    they have pressed <strong>Save signatures</strong> on their own screen.
                  </p>
                ) : (
                  <p>
                    Nobody has signed this document yet. Its signatures appear here as soon as members press{' '}
                    <strong>Sign this document</strong> on their own screen.
                  </p>
                ))}
              {emptyReason === 'only-yours' && (
                <>
                  <p>
                    {isChecklistTarget ? (
                      <>
                        The only signed items on this checklist are <strong>yours</strong> (you cannot verify your own
                        checklist).
                      </>
                    ) : (
                      <>
                        The only signature on this document is <strong>yours</strong> (you cannot confirm your own
                        signature).
                      </>
                    )}
                  </p>
                  <p className="mt-1">
                    Another member&rsquo;s {isChecklistTarget ? 'items' : 'signature'} appear here as soon as they sign.{' '}
                    To have your own checked, ask somebody else with the <strong>Verify signatures</strong> permission.
                  </p>
                </>
              )}
              {emptyReason === 'all-verified' && (
                <p>
                  Everything signed {isChecklistTarget ? 'on this checklist' : 'on this document'} has been confirmed.
                  Nothing is waiting.
                </p>
              )}
            </div>
          )}

          {/* A DOCUMENT: one signature to confirm per member, so the list is the whole job - no expanding, no
              item-by-item work, and no "verify all", because each row already IS all of it. The row still shows WHEN
              they signed, since that is what the confirmation is being given against. */}
          {!error && !isChecklistTarget && waiting.length > 0 && (
            <ul className="space-y-1.5">
              {waiting.map((entry) => (
                <li
                  key={entry.userId}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">
                    {memberName(entry.userId)}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    Signed {signatureDateLabel({ signed_at: entry.signedAt }, timeFormat) || 'on file'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleVerifyDocument(entry.userId)}
                    disabled={Boolean(verifyingMemberId)}
                    className="shrink-0 flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-60"
                  >
                    {verifyingMemberId === entry.userId ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <BadgeCheck className="w-3.5 h-3.5" />
                    )}
                    Confirm
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!error && isChecklistTarget && waiting.length > 0 && (
            <ul className="space-y-1.5">
              {waiting.map((entry) => (
                <li key={entry.userId}>
                  <button
                    type="button"
                    onClick={() => setOpenMemberId((current) => (current === entry.userId ? '' : entry.userId))}
                    aria-expanded={openMemberId === entry.userId}
                    className={`w-full flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                      openMemberId === entry.userId
                        ? 'border-red-500 bg-slate-50 dark:bg-slate-900'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">
                      {memberName(entry.userId)}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">
                      {entry.remaining.length} to verify
                    </span>
                    <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                      {entry.signed} of {entry.total} signed
                    </span>
                  </button>

                  {openMemberId === entry.userId && openMemberQueue && (
                    <div className="mt-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {checklistProgressLabel(items, signatures, entry.userId)}
                        </p>
                        <button
                          type="button"
                          onClick={() => setConfirmingAll(true)}
                          disabled={verifyingAll}
                          className="ml-auto flex items-center gap-2 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-60"
                        >
                          {verifyingAll ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <BadgeCheck className="w-3.5 h-3.5" />
                          )}
                          Verify all {openMemberQueue.remaining.length}
                        </button>
                      </div>

                      <ul className="mt-2 space-y-1.5">
                        {openMemberQueue.remaining.map((state) => (
                          <li
                            key={state.itemId}
                            className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                          >
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-slate-700 dark:text-slate-200">{state.item.label}</p>
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                Signed {signatureDateLabel(signatureFor(state.itemId), timeFormat) || 'on file'}
                                {state.stale ? ' · the item changed since, so this covers the earlier wording' : ''}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleVerifyItem(state.itemId)}
                              disabled={Boolean(verifyingItemId)}
                              className="shrink-0 rounded-xl border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                            >
                              {verifyingItemId === state.itemId ? 'Verifying…' : 'Verify'}
                            </button>
                          </li>
                        ))}
                      </ul>

                      {openMemberQueue.verified > 0 && (
                        <div className="mt-2">
                          {/* List of items that have already been signed off. */}
                          <button
                            type="button"
                            onClick={() =>
                              setShowingVerifiedFor((current) =>
                                current === entry.userId ? '' : entry.userId
                              )
                            }
                            aria-expanded={showingVerifiedFor === entry.userId}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                          >
                            <BadgeCheck className="w-3.5 h-3.5" />
                            {openMemberQueue.verified} already verified
                            {showingVerifiedFor === entry.userId ? ' — hide' : ' — show'}
                          </button>

                          {showingVerifiedFor === entry.userId && (
                            <ul className="mt-1.5 space-y-1.5">
                              {openMemberQueue.verifiedItems.map((state) => (
                                <li
                                  key={state.itemId}
                                  className="flex flex-wrap items-baseline gap-x-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/20"
                                >
                                  <CheckCircle2 className="h-4 w-4 shrink-0 self-center text-emerald-600" />
                                  <span className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">
                                    {state.item.label}
                                  </span>
                                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                    {checklistVerifiedLabel(
                                      state,
                                      state.verifiedByUserId ? memberName(state.verifiedByUserId) : '',
                                      timeFormat
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {confirmingAll && openMemberId && openMemberQueue && (
        <ConfirmModal
          tone="default"
          title={`Verify all ${openMemberQueue.remaining.length} item${
            openMemberQueue.remaining.length === 1 ? '' : 's'
          } for ${memberName(openMemberId)}?`}
          message="Each of their signed items is marked as confirmed by you, with today's date. This records that a check was made, so only confirm items you have actually checked."
          confirmLabel={verifyingAll ? 'Verifying…' : 'Confirm them all'}
          onConfirm={handleVerifyRemaining}
          onCancel={() => setConfirmingAll(false)}
        />
      )}
    </div>
  );
}

export default AdminChecklistVerification;
