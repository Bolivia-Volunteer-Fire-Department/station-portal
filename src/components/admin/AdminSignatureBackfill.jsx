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

// THE TICK GRID, on its own so the panel above reads as a panel: sections with their own all/none, and one row per
// item. Two things about it are worth stating.
//
// AN ITEM ALREADY ON FILE IS NOT CLICKABLE, and it says which kind of "done" it is. A member who ticked it in the app
// and a member whose row an officer entered from paper are both done, and the officer working through the rest of that
// person's file needs to see which - so the date and the word are shown rather than the row simply going grey. Offering
// the tick would also be offering a save that writes nothing, since the writer refuses a second row for an item.
//
// THE SECTIONS KEEP THEIR ALL/NONE, because the real files are like the real checklists: "the whole exterior section was
// done" is one fact, and it should be one click rather than eleven.
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

// BACK-FILLING THE PAPER FILES: recording what people did before this app existed.
//
// THE JOB THIS DOES. A station moves to this app and finds the crew has been doing the truck checks, the policy
// acknowledgements and the drills on paper for years. There are three ways to handle that, and this screen exists
// because the first two are wrong: make everybody re-do the work in the app (they will not, and they should not have
// to), leave the history blank (so every member looks like they have done nothing - worse than useless when somebody
// asks who has read the SCP), or enter it from the paper (correct, but done one item at a time through the member's own
// screen, for every item of every person, it is an afternoon of clicking).
//
// So: the third option with the clicking taken out. The shape is ONE MEMBER AT A TIME, because that is the shape of the
// paper - an officer sits down with a stack of files and works through them, and "this person did these things, that
// person did those" is a per-person fact. Pick the person, tick what their file says, press Save, and - if there is
// another file in the stack - Save & next, which keeps the same checklist, date and note and moves to the next name.
// Filling in a crew of thirty becomes one pass with no screen to find again.
//
// WHY IT IS SAFE TO LET AN OFFICER WRITE SOMEBODY ELSE'S SIGNATURE. The row says what it is: `backfilled` is true,
// `signed_by_user_id` is the officer, and the note and the moment of entry go with it. The rules refuse that shape
// unless the flag is set, so this screen cannot be used to forge an ordinary in-app signature, and every place that
// reads a signature can tell the two apart - including this one, which labels them. See utils/documents.
//
// AND IT IS A RULE, NOT A SECOND OPINION. What gets written is worked out by `backfillableItemIds`, the same pure
// function the count on the button comes from, so "4 items" and the four rows that land cannot drift apart. An item
// somebody has already signed - in the app, or by an earlier back-fill - is not selectable, and ticking it would write
// nothing.
function AdminSignatureBackfill({ token, documents = [], users = [], currentUserId = '', timeFormat = '12' }) {
  const [documentId, setDocumentId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [items, setItems] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // What the officer has ticked but not saved: item ids in a Set, so a double click is one entry.
  const [ticked, setTicked] = useState(() => new Set());
  const [recordedOn, setRecordedOn] = useState(todayKey);
  const [note, setNote] = useState('');
  const [confirmVerified, setConfirmVerified] = useState(true);
  const [saving, setSaving] = useState(false);

  // Only what has a signature to record: a checklist, or a document that members must sign. Offering a document nobody
  // has to sign would be a screen that does nothing.
  //
  // READ THROUGH `normalizeDocument`, like every other screen and the writer itself. The raw test this used to make
  // (`row.is_sign_required === true`) is true of a row this app saved and FALSE of the same row written by the sheet -
  // where the cell is 'TRUE' and the column has held strings since long before the move. A migrated document would then
  // be missing from this list while the server would have accepted the back-fill for it, which is the kind of
  // disagreement between two readings of one column that utils/documents exists to prevent.
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

  // Everybody except the officer doing the recording: a back-fill is somebody else's record and the server refuses the
  // alternative, so offering your own name here would be offering a save that always fails.
  const members = useMemo(
    () =>
      backfillCandidates(users, currentUserId)
        .slice()
        .sort((a, b) => userLabel(a).localeCompare(userLabel(b))),
    [users, currentUserId]
  );

  const loadSignatures = useCallback(
    async (wanted) => {
      // Nothing chosen yet: the panel is empty rather than loading, and this is settled BEFORE the await so the branch
      // is not a second place the state is written from.
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

  // The checklist is read when it is chosen. The ticks are NOT cleared here: they are cleared where the cause is - in
  // the two pickers below - because an effect that resets state on a dependency change is a second, less obvious place
  // for "what is ticked" to be decided, and the two would eventually disagree.
  useEffect(() => {
    loadSignatures(documentId);
  }, [documentId, loadSignatures]);

  // Moving to another document, or another member, drops the ticks: they mean "the officer is in the middle of entering
  // THIS file", so carrying them across would put one person's paper against another person's record.
  const chooseDocument = (id) => {
    setDocumentId(id);
    setTicked(new Set());
  };

  const chooseMember = (id) => {
    setMemberId(id);
    setTicked(new Set());
  };

  // THE GRID: the checklist's items in order, grouped by section, each with whether it is already accounted for and how.
  //
  // The state is asked for the SELECTED member only, because that is the only member this screen ever writes for. A
  // per-member progress figure therefore belongs in the panel below the picker rather than beside every name in the
  // list, where one read could not honestly fill it in.
  const sections = useMemo(() => (isChecklist ? checklistSections(items) : []), [isChecklist, items]);

  const itemStates = useMemo(
    () => backfillItemStates(items, signatures, memberId),
    [items, signatures, memberId]
  );

  // EVERYTHING THE SCREEN SAYS ABOUT WHAT WILL BE WRITTEN COMES FROM HERE - one list, so the count beside the button,
  // the "already on file" wording and the request body cannot disagree. The writer decides it again with the same
  // function, which is what makes them one definition rather than two opinions.
  const pending = useMemo(
    () => backfillableItemIds(items, signatures, memberId, [...ticked]),
    [items, signatures, memberId, ticked]
  );

  const recordedStates = useMemo(() => itemStates.filter((state) => state.recorded), [itemStates]);
  // A plain document is ONE row rather than many, so there is nothing to tick: the member is the whole selection.
  const wholeDocumentPending = !isChecklist && memberId !== '' && recordedStates.length === 0;

  const toggle = (id) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A section's all/none, and the whole checklist's. `selectable` is the items NOT already on file, so "select all"
  // never claims to be adding something that is already there.
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
      toast.error('Tick the items that member has done, then save.');
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
      // The rows that landed come back with the reply, so the grid is redrawn from what is STORED rather than from what
      // was ticked - the discipline the rest of this tab follows.
      setSignatures(normalizeSignatureList(result.signatures));
      setTicked(new Set());

      if (advance) {
        // That file is done, so the next one is opened: same checklist, same date, same note, next name down the list.
        // This is the whole ergonomic point - an officer with a stack of paper should never have to find this screen
        // again, let alone pick the checklist and the date over for each person.
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
          person, tick what they have done, and save once. <strong>Save &amp; next</strong> moves down the pile with the
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
                {/* AN EMPTY LIST SAID OUT LOUD. This select has one control and no other content, so when the list is
                    empty the panel is simply blank - which is what "I cannot select any members" looked like, and it
                    was in fact the crew directory never having been read for this tab (see sectionsForTab in App.jsx).
                    A sentence costs nothing and turns a dead-looking dropdown into a statement somebody can act on. */}
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
                {/* THE RECORD OF THE PAPER ITSELF. Both fields belong to the whole sitting rather than to one member,
                    which is why they sit above the grid and survive Save & next: a stack of files is usually one
                    year's worth of paper, and the note is what makes the entry defensible a year later. */}
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

                {/* Whether copying a file down also CONFIRMS it is a visible choice rather than an implied one. On by
                    default, because the paper being copied was already signed off by a supervisor; off, for a station
                    that would rather these went through the ordinary verification queue below. */}
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

                {/* THE TWO SAVES. "Save" is for a file you are part-way through; "Save & next member" keeps the
                    checklist, the date and the note and moves to the next name down the list, which is what makes
                    working through a stack of paper one pass instead of thirty. */}
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