import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { fetchDocumentSignatures, verifyChecklistItem, verifyChecklistRemaining, verifyDocumentSignature } from '../../services/api';
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

// Verifying a member's checklist from the Administration module.
//
// The Documents module has a verification panel too, but it sits on whichever checklist the verifier happens to be
// reading. This is the other direction, and the one a company officer actually needs: pick the CHECKLIST, then the
// MEMBER, and confirm what they signed, item by item. It answers "who is waiting on me", which a panel scoped to
// one open document cannot.
//
// It lives on the Documents tab rather than in a tab of its own so the permission that opens it can stay a MEMBER
// permission: the officer checking a new member's truck checklist should not have to be able to edit that
// checklist, and should not have to become an administrator to confirm it was done. Nothing here decides who may
// verify - the server refuses self-verification and re-checks the permission on every action, and this screen
// simply does not offer what would fail.
function AdminChecklistVerification({ token, documents = [], users = [], currentUserId = '', timeFormat = '12' }) {
  const [requestedListId, setRequestedListId] = useState('');
  const [items, setItems] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openMemberId, setOpenMemberId] = useState('');
  const [verifyingItemId, setVerifyingItemId] = useState('');
  // The member whose DOCUMENT signature is being confirmed, which is a different question from the item above: one row
  // for a whole document rather than one row per line. Kept apart so the two spinners cannot be read for each other.
  const [verifyingMemberId, setVerifyingMemberId] = useState('');
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  // Which member's already-verified items are expanded. Collapsed by default: the panel is a to-do list, and the
  // work is what is still outstanding - the record is what you open when somebody asks about it.
  const [showingVerifiedFor, setShowingVerifiedFor] = useState('');

  // WHAT CAN BE CONFIRMED HERE: the checklists, whose items are confirmed one by one, and the documents whose author has
  // asked for the signature itself to be confirmed. Two shapes of one job, which is why they share this panel and the
  // permission that opens it - and `documentRequiresVerification` is the single rule that decides the second, so a
  // document whose requirement has since been turned off drops out of here along with everything else.
  const verifiable = useMemo(
    () =>
      (Array.isArray(documents) ? documents : []).filter(
        (row) => row.doc_type === 'checklist' || documentRequiresVerification(row)
      ),
    [documents]
  );

  // One that has since been deleted is not a choice, and an empty picker with nothing selected would make the screen
  // look broken, so the first one is opened.
  const activeListId = useMemo(() => {
    if (requestedListId && verifiable.some((row) => row.id === requestedListId)) return requestedListId;
    return verifiable.length > 0 ? verifiable[0].id : '';
  }, [verifiable, requestedListId]);

  const activeDocument = useMemo(
    () => verifiable.find((row) => row.id === activeListId) || null,
    [verifiable, activeListId]
  );

  // WHICH OF THE TWO JOBS THIS IS. A checklist is confirmed line by line; anything else that got this far is confirmed
  // once, against the signature the member gave, and the two are drawn differently because they ask different things.
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

  // Reloaded whenever the chosen checklist changes, and never kept across one: every name in this list was read
  // against the document that was selected at the time.
  useEffect(() => {
    setOpenMemberId('');
    loadSignatures(activeListId);
  }, [activeListId, loadSignatures]);

  // ONE LIST, whichever kind of confirmation is being done: the members with something outstanding on this document.
  // The item arithmetic reads the checklist's lines; the document one reads the signature rows themselves, because a
  // whole-document signature has no line to hang off. Both leave out the verifier's own - the server refuses
  // self-verification, so offering it would be offering a button that always fails.
  const waiting = useMemo(
    () =>
      isChecklistTarget
        ? membersAwaitingVerification(items, signatures, currentUserId)
        : membersAwaitingDocumentVerification(activeDocument || {}, signatures, currentUserId),
    [isChecklistTarget, activeDocument, items, signatures, currentUserId]
  );

  // Why the list can be empty, worked out from the same data the list is built from. "Nothing is waiting to be
  // verified" is true and useless: it reads as broken to somebody who has just watched a member tick boxes, and
  // the honest answers are different problems with different fixes.
  //
  //   * the checklist has no items yet - nothing to sign, nothing to confirm;
  //   * nobody has signed anything - the member has not saved their ticks;
  //   * everything signed is the VIEWER's own, and the server refuses self-verification, so it is filtered out by
  //     design. This is the one that looks like a bug and is not, which is why it says so;
  //   * everything signed has already been confirmed.
  const emptyReason = useMemo(() => {
    if (isChecklistTarget && items.length === 0) return 'no-items';

    const wantedVerifier = String(currentUserId || '').trim();
    // The rows that could have been confirmed: a checklist's ticked ITEMS, or - on a document - the signatures
    // themselves, which carry no item (see WHOLE_DOCUMENT_ITEM in utils/documents).
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

  // Every verification reloads from the server's own answer rather than from what was clicked, so the rows and the
  // counts can never disagree with the sheet.
  const handleVerifyItem = async (itemId) => {
    if (!activeListId || !openMemberId || verifyingItemId) return;

    setVerifyingItemId(itemId);
    try {
      const result = await verifyChecklistItem(activeListId, itemId, openMemberId, token);
      if (!result?.success) throw new Error(result?.message || 'Could not record the verification.');
      setSignatures(normalizeSignatureList(result.signatures));
      toast.success(result.already_verified ? 'That was already verified.' : 'Verified.');
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
    } catch (err) {
      toast.error(err?.message || 'Could not record the verifications.');
    } finally {
      setVerifyingAll(false);
    }
  };

  // Confirming a DOCUMENT's signature rather than an item of a checklist: the same act, once for the whole document,
  // and reloaded from the server's answer for the same reason - the rows and the counts must never be this screen's
  // guess about what happened.
  const handleVerifyDocument = async (memberId) => {
    if (!activeListId || verifyingMemberId) return;

    setVerifyingMemberId(memberId);
    try {
      const result = await verifyDocumentSignature(activeListId, memberId, token);
      if (!result?.success) throw new Error(result?.message || 'Could not record the confirmation.');
      setSignatures(normalizeSignatureList(result.signatures));
      toast.success(result.already_verified ? 'That was already confirmed.' : 'Signature confirmed.');
    } catch (err) {
      toast.error(err?.message || 'Could not record the confirmation.');
    } finally {
      setVerifyingMemberId('');
    }
  };

  // A member's name from the users this panel already holds. The shared label helpers are used so an id with no
  // matching user reads the way it does everywhere else, rather than as a raw id.
  const memberName = (userId) => {
    const user = users.find((row) => String(row.id) === String(userId));
    return user ? userLabel(user) : unnamedLabel(userId);
  };

  // The signature row behind one item of the open member's checklist: the source of the date shown beside it.
  const signatureFor = (itemId) =>
    signatures.find(
      (signature) => signature.checklist_item_id === itemId && signature.user_id === openMemberId
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
          onClick={() => loadSignatures(activeListId)}
          disabled={loading || !activeListId}
          className="ml-auto flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
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
          <div>
            <label htmlFor="verification-checklist" className={labelClass}>
              Checklist or document
            </label>
            <select
              id="verification-checklist"
              value={activeListId}
              onChange={(event) => setRequestedListId(event.target.value)}
              className={fieldClass}
            >
              {verifiable.map((row) => (
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
            </select>
          </div>

          {error && (
            <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          {!error && loading && items.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading signatures…
            </p>
          )}

          {!error && !loading && waiting.length === 0 && (
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
                          {/* The record, for when somebody asks "who checked this, and when?". The outstanding list
                              above is the WORK; this is what has already been signed off, item by item, with the
                              verifier and the date on each one. */}
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
