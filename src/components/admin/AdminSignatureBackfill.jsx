import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Loader2, Save } from 'lucide-react';
import { adminBackfillDocumentSignatures, fetchDocumentSignatures } from '../../services/api';
import { toast } from '../../utils/toast';
import {
  BACKFILL_NOTE_LIMIT,
  WHOLE_DOCUMENT_ITEM,
  backfillCandidates,
  backfillItemStates,
  backfillableItemIds,
  normalizeDocument,
  normalizeSignatureList,
  signatureDateLabel,
} from '../../utils/documents';
import { checklistSections } from '../../utils/checklists';
import { userLabel } from '../../utils/displayLabel';

const fieldClass =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500';

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// Checklist item grid with section headers and select all/none controls.
function BackfillItemGrid({ gridItems, itemStates, selectable, ticked, onToggle, onAllFor, timeFormat = '12' }) {
  return (
    <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
      {gridItems.map((group) => {
        const groupIds = group.items
          .map((item) => String(item.id || '').trim())
          .filter((id) => selectable.includes(id));
        const groupAll = groupIds.length > 0 && groupIds.every((id) => ticked.has(id));

        return (
          <div key={group.section || 'items'}>
            <div className="sticky top-0 flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {group.section || 'Items'}
              </span>
              {groupIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onAllFor(groupIds, !groupAll)}
                  className="ml-auto text-xs font-medium text-slate-600 hover:underline dark:text-slate-300"
                >
                  {groupAll ? 'none' : 'all'}
                </button>
              )}
            </div>
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {group.items.map((item) => {
                const id = String(item.id || '').trim();
                const state = itemStates.find((entry) => entry.itemId === id);
                const already = Boolean(state && state.recorded);
                return (
                  <li key={id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      id={`backfill-item-${id}`}
                      type="checkbox"
                      checked={ticked.has(id)}
                      disabled={already}
                      onChange={() => onToggle(id)}
                      className="h-4 w-4 rounded border-slate-300 accent-red-600 disabled:opacity-40"
                    />
                    <label
                      htmlFor={`backfill-item-${id}`}
                      className={`text-sm ${
                        already ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {item.label}
                    </label>
                    {already && (
                      <span className="ml-auto shrink-0 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                        {state.signedByMember
                          ? signatureDateLabel({ signed_at: state.recordedAt }, timeFormat)
                          : signatureDateLabel({ signed_at: state.recordedAt }, timeFormat, 'Recorded')}
                        {!state.verified ? ' · not confirmed' : ''}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// Tool for administrators to record past paper signatures and checklist items.
function AdminSignatureBackfill({ token, documents = [], users = [], currentUserId = '', timeFormat = '12' }) {
  const [documentId, setDocumentId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [items, setItems] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Set of currently checked item IDs
  const [ticked, setTicked] = useState(() => new Set());
  const [recordedOn, setRecordedOn] = useState(todayKey);
  const [note, setNote] = useState('');
  const [confirmVerified, setConfirmVerified] = useState(true);
  const [saving, setSaving] = useState(false);

  // Only documents or checklists requiring a signature
  const signable = useMemo(
    () =>
      (Array.isArray(documents) ? documents : []).filter((row) => {
        const normalized = normalizeDocument(row);
        return normalized.doc_type === 'checklist' || normalized.is_sign_required;
      }),
    [documents]
  );

  const activeDocument = useMemo(
    () => signable.find((row) => row.id === documentId) || null,
    [signable, documentId]
  );
  const isChecklist = activeDocument?.doc_type === 'checklist';

  // List of other members who can have signatures backfilled
  const members = useMemo(
    () =>
      backfillCandidates(users, currentUserId)
        .slice()
        .sort((a, b) => userLabel(a).localeCompare(userLabel(b))),
    [users, currentUserId]
  );

  const loadSignatures = useCallback(
    async (wanted) => {
      // Reset items and signatures if no document is selected
      if (!wanted) {
        setItems([]);
        setSignatures([]);
        setError('');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const result = await fetchDocumentSignatures(wanted, token);
        if (!result?.success) throw new Error(result?.message || 'Could not load the signatures.');
        setItems(Array.isArray(result.items) ? result.items : []);
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

  useEffect(() => {
    loadSignatures(documentId);
  }, [documentId, loadSignatures]);

  // Reset selections when changing document or member
  const chooseDocument = (id) => {
    setDocumentId(id);
    setTicked(new Set());
  };

  const chooseMember = (id) => {
    setMemberId(id);
    setTicked(new Set());
  };

  const sections = useMemo(() => (isChecklist ? checklistSections(items) : []), [isChecklist, items]);

  const itemStates = useMemo(
    () => backfillItemStates(items, signatures, memberId),
    [items, signatures, memberId]
  );

  // List of items ready to be backfilled
  const pending = useMemo(
    () => backfillableItemIds(items, signatures, memberId, [...ticked]),
    [items, signatures, memberId, ticked]
  );

  const recordedStates = useMemo(() => itemStates.filter((state) => state.recorded), [itemStates]);
  const wholeDocumentPending = !isChecklist && memberId !== '' && recordedStates.length === 0;

  const toggle = (id) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Items that have not been recorded yet
  const selectable = useMemo(
    () => itemStates.filter((state) => !state.recorded).map((state) => state.itemId),
    [itemStates]
  );
  const allTicked = selectable.length > 0 && selectable.every((id) => ticked.has(id));

  const setAllFor = (ids, on) =>
    setTicked((current) => {
      const next = new Set(current);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
const handleSave = async ({ advance = false } = {}) => {
    if (saving) return;
    if (!activeDocument) return;
    if (!memberId) {
      toast.error('Choose the member this file belongs to.');
      return;
    }
    // A plain document is one row, so the member IS the selection. A checklist with nothing ticked has nothing to write,
    // and saying so is better than a save that reports zero.
    if (isChecklist && pending.length === 0) {
      toast.error('Check the items that member has done, then save.');
      return;
    }
    if (!isChecklist && !wholeDocumentPending) {
      toast.error('That member already has a signature on this document.');
      return;
    }

    setSaving(true);
    try {
      const result = await adminBackfillDocumentSignatures(
        {
          documentId: activeDocument.id,
          userId: memberId,
          // A plain document is ONE row and its id is the empty one - the same marker every reader here uses for "the
          // document itself" (see WHOLE_DOCUMENT_ITEM), rather than a bare '' that reads like a missing value.
          itemIds: isChecklist ? pending : [WHOLE_DOCUMENT_ITEM],
          recordedOn,
          note,
          confirmVerified,
        },
        token
      );
      if (!result?.success) throw new Error(result?.message || 'Could not record that.');
      const recorded = result.recorded || 0;
      if (recorded === 0) {
        toast.info(result.message || 'Everything you ticked is already recorded.');
      } else {
        const who = userLabel(members.find((user) => String(user.id) === memberId) || {});
        toast.success(`Recorded ${recorded} item${recorded === 1 ? '' : 's'} for ${who}.`, {
          description: confirmVerified
            ? 'Also confirmed, attributed to you as the verifier.'
            : 'The member can be verified from the queue below.',
        });
      }
      setSignatures(normalizeSignatureList(result.signatures));
      setTicked(new Set());

      if (advance) {
        // Advance to the next member in the list
        const at = members.findIndex((user) => String(user.id) === memberId);
        const next = members[at + 1];
        if (next) {
          chooseMember(String(next.id));
        } else {
          toast.info('That was the last member in the list.');
          setMemberId('');
        }
      }
    } catch (err) {
      toast.error(err?.message || 'Could not record that.');
    } finally {
      setSaving(false);
    }
  };

  const gridItems = sections.length > 0 ? sections : [{ section: '', items: items.map((item) => item) }];

  return (
    <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <History className="w-4 h-4 text-red-500" />
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Back-fill from paper records</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          For work people did before the station had this app
        </span>
      </div>

      <div className="space-y-4 p-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Record what a member&rsquo;s paper file says without them re-doing any of it: pick the checklist, pick the
          person, check what they have done, and save once. <strong>Save &amp; next</strong> moves down the pile with the
          same date and note. Every row is stamped with your name and marked as recorded from paper, so nobody can
          mistake it later for something the member ticked themselves.
        </p>

        {signable.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Nothing to back-fill yet: this needs a checklist, or a document that members must sign.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="backfill-document"
                  className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300"
                >
                  Checklist or document
                </label>
                <select
                  id="backfill-document"
                  value={documentId}
                  onChange={(event) => chooseDocument(event.target.value)}
                  className={fieldClass}
                >
                  <option value="">Choose one…</option>
                  {signable.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.title || 'Untitled'}
                      {row.folder ? ` — ${row.folder}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="backfill-member"
                  className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300"
                >
                  Member
                </label>
                <select
                  id="backfill-member"
                  value={memberId}
                  onChange={(event) => chooseMember(event.target.value)}
                  className={fieldClass}
                  disabled={!documentId}
                >
                  <option value="">Choose one…</option>
                  {members.map((user) => (
                    <option key={String(user.id)} value={String(user.id)}>
                      {userLabel(user)}
                    </option>
                  ))}
                </select>
                {members.length === 0 && (
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    No members to record for. The crew list could not be read, or you are the only member on it — a
                    back-fill is somebody else recording what they found, so your own name is never offered.
                  </p>
                )}
              </div>
            </div>

            {error && (
              <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}

            {documentId && memberId && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="backfill-date" className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
                      Date this was done
                    </label>
                    <input
                      id="backfill-date"
                      type="date"
                      value={recordedOn}
                      onChange={(event) => setRecordedOn(event.target.value)}
                      className={fieldClass}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="backfill-note" className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
                      Note (optional)
                    </label>
                    <input
                      id="backfill-note"
                      type="text"
                      value={note}
                      maxLength={BACKFILL_NOTE_LIMIT}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Paper file, apparatus checks 2024"
                      className={fieldClass}
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={confirmVerified}
                    onChange={(event) => setConfirmVerified(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-red-600"
                  />
                  <span>
                    Also confirm these as <strong>verified</strong>, attributed to me. Leave it off if somebody else
                    should confirm them later.
                  </span>
                </label>

                {loading ? (
                  <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading the checklist…
                  </p>
                ) : isChecklist ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {recordedStates.length} of {items.length} already recorded · {pending.length} to save
                      </span>
                      <button
                        type="button"
                        onClick={() => setAllFor(selectable, !allTicked)}
                        disabled={selectable.length === 0}
                        className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        {allTicked ? 'Clear all' : 'Select everything left'}
                      </button>
                    </div>
                    <BackfillItemGrid
                      gridItems={gridItems}
                      itemStates={itemStates}
                      selectable={selectable}
                      ticked={ticked}
                      onToggle={toggle}
                      onAllFor={setAllFor}
                      timeFormat={timeFormat}
                    />
                  </div>
                ) : (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    {recordedStates.length > 0
                      ? 'That member has a signature on this document already.'
                      : 'Saving below records this member\u2019s acknowledgment of the whole document.'}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => handleSave()}
                    disabled={saving || (isChecklist ? pending.length === 0 : !wholeDocumentPending)}
                    className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {isChecklist
                      ? `Save ${pending.length} item${pending.length === 1 ? '' : 's'}`
                      : 'Record signature'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSave({ advance: true })}
                    disabled={saving || (isChecklist ? pending.length === 0 : !wholeDocumentPending)}
                    className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Save &amp; next member
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default AdminSignatureBackfill;