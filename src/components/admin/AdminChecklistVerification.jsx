import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { fetchDocumentSignatures, verifyChecklistItem, verifyChecklistRemaining } from '../../services/api';
import { toast } from '../../utils/toast';
import ConfirmModal from '../ConfirmModal';
import { normalizeChecklistItemList, normalizeSignatureList, signatureDateLabel } from '../../utils/documents';
import {
  checklistProgressLabel,
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
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);

  // Only checklists have anything to confirm item by item: a document's signature is the whole acknowledgment.
  const checklists = useMemo(
    () => (Array.isArray(documents) ? documents : []).filter((row) => row.doc_type === 'checklist'),
    [documents]
  );

  // A checklist that has since been deleted is not a choice, and an empty picker with nothing selected would make
  // the screen look broken, so the first one is opened.
  const activeListId = useMemo(() => {
    if (requestedListId && checklists.some((row) => row.id === requestedListId)) return requestedListId;
    return checklists.length > 0 ? checklists[0].id : '';
  }, [checklists, requestedListId]);


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

  const waiting = useMemo(
    () => membersAwaitingVerification(items, signatures, currentUserId),
    [items, signatures, currentUserId]
  );

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
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Verify checklists</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Confirm the items another member has signed. Nobody can verify their own checklist.
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

      {checklists.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          There are no checklists yet. Once one exists, the members who sign its items appear here.
        </p>
      ) : (
        <>
          <div>
            <label htmlFor="verification-checklist" className={labelClass}>
              Checklist
            </label>
            <select
              id="verification-checklist"
              value={activeListId}
              onChange={(event) => setRequestedListId(event.target.value)}
              className={fieldClass}
            >
              {checklists.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                  {row.folder ? ` — ${row.folder}` : ''}
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
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nothing is waiting to be verified on this checklist.
            </p>
          )}

          {!error && waiting.length > 0 && (
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
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          {openMemberQueue.verified} item
                          {openMemberQueue.verified === 1 ? ' is' : 's are'} already verified on this checklist.
                        </p>
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
