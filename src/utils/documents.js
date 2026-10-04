// Documents: the shapes and the pure decisions the member module and the administration tab share.
//
// The server owns the rules that decide ACCESS (published, and at or above the member's rank) and returns the
// list already in order. What lives here is everything about how a READER sees it: the folder groups, the search
// filter, the row shape, and the client half of the save validation. Pure and dependency-free, so it is testable
// without a browser - see scripts/verify-documents.mjs.

// THE FILE EXTENSIONS ARE LOAD-BEARING. Vite resolves `./systemLog` happily, so these two lines looked fine for as long
// as this module was only ever reached through the bundler. It is not any more: `firestoreReads.js` and
// `firestoreWrites.js` import this module for `isAssessment`/`assessmentScoreId`, and `scripts/verify-firestore-writes.mjs`
// imports THOSE unbundled, straight into Node - which requires the extension and failed with ERR_MODULE_NOT_FOUND.
// Naming the file is what makes the same module work in both.
import { formatLogTimestamp } from './systemLog.js';
import { dateLifecycle, dateWindowError, dateWindowLabel, effectiveDateKey } from './effectiveDates.js';

// The kinds of document. `markdown` is free text with formatting; `checklist` adds items signed one at a
// time; `link` is a single address pointing at something kept elsewhere; `assessment` is a document that also
// carries a SCORE per member. Anything unrecognized reads as markdown rather than as an empty screen.
//
// `assessment` IS a markdown body plus a score panel, not a replacement for one: the assessment's wording is what the
// score is a score OF, so it is kept in the same `content` field and rendered by the same reader. The panel underneath
// is the whole of the difference.
export const DOCUMENT_TYPES = ['markdown', 'checklist', 'link', 'assessment'];

// A link is only offered as followable when it is an address a browser will treat as one, and only http(s) counts.
// The server refuses to STORE anything else, so this is the second half of one rule rather than a second rule -
// and it is what keeps a `javascript:` value out of an href if one ever reaches the client.
export const DOCUMENT_LINK_SCHEMES = ['http://', 'https://'];

export const documentLinkProblem = (content) => {
  const url = text(content);
  if (!url) return 'A link document needs an address.';
  const lowered = url.toLowerCase();
  if (!DOCUMENT_LINK_SCHEMES.some((scheme) => lowered.startsWith(scheme) && url.length > scheme.length)) {
    return 'A link must start with http:// or https://.';
  }
  if (/\s/.test(url)) return 'A link cannot contain spaces.';
  return '';
};

// The address of a link document, or '' when it is not one this app will offer. Never an href a caller can build
// from an unvalidated cell.
export const documentLinkUrl = (document) => {
  const normalized = normalizeDocument(document);
  if (normalized.doc_type !== 'link') return '';
  return documentLinkProblem(normalized.content) ? '' : normalized.content;
};

// The sheet's own limit is 50,000 characters in a cell; the server caps a save below that and so does the form,
// so the author is told while typing rather than by a refusal afterwards.
export const DOCUMENT_CONTENT_LIMIT = 45000;

// What a document with no folder is called. Never stored - a blank `folder` cell is unfiled, and this is only the
// name it is shown under.
export const UNFILED_LABEL = 'Unfiled';

const text = (value) => String(value ?? '').trim();

export const normalizeDocument = (row) => {
  const source = row || {};
  const requestedType = text(source.doc_type).toLowerCase();
  const order = Number.parseInt(source.sort_order, 10);
  const revision = Number.parseInt(source.content_revision, 10);
  const length = Number.parseInt(source.content_length, 10);
  const itemCount = Number.parseInt(source.item_count, 10);
  const itemsSigned = Number.parseInt(source.items_signed, 10);

  return {
    id: text(source.id),
    title: text(source.title),
    folder: text(source.folder),
    doc_type: DOCUMENT_TYPES.includes(requestedType) ? requestedType : 'markdown',
    sort_order: Number.isFinite(order) ? order : 0,
    is_published: source.is_published === true || text(source.is_published).toUpperCase() === 'TRUE',
    rank_id: text(source.rank_id),
    is_sign_required: source.is_sign_required === true || text(source.is_sign_required).toUpperCase() === 'TRUE',
    // The window, read through the schedule's own date parser so a real date cell, a typed date and an ISO string
    // all land on the same yyyy-MM-dd key. '' is "no restriction", never "retired".
    effective_date: effectiveDateKey(source.effective_date),
    end_date: effectiveDateKey(source.end_date),
    content_revision: Number.isFinite(revision) ? revision : 0,
    content_length: Number.isFinite(length) ? length : 0,
    // How many items a checklist has, and how many of them THIS member has signed. Server-computed, because the
    // list carries no items: a checklist cannot advertise "3 to sign" from a document-level signature, since it
    // does not have one.
    item_count: Number.isFinite(itemCount) ? itemCount : 0,
    items_signed: Number.isFinite(itemsSigned) ? itemsSigned : 0,
    author_user_id: text(source.author_user_id),
    updated_at: text(source.updated_at),
    row_version: source.row_version ?? '',
    // Only the single-document read carries these.
    content: source.content === undefined || source.content === null ? '' : String(source.content),
    items: normalizeChecklistItemList(source.items),
  };
};

export const normalizeDocumentList = (rows) =>
  (Array.isArray(rows) ? rows : []).map(normalizeDocument).filter((document) => document.id !== '');

export const isChecklist = (document) => normalizeDocument(document).doc_type === 'checklist';

// A link document holds an address instead of a body, so the reader offers to open it rather than rendering text.
export const isLink = (document) => normalizeDocument(document).doc_type === 'link';

// An assessment document keeps its body and adds a score per member. The screen uses this to decide whether to draw the
// score panel - and, importantly, the READER only ever draws it read-only; entering a score needs its own permission
// and lives in the panel's officer half.
export const isAssessment = (document) => normalizeDocument(document).doc_type === 'assessment';

// ---------------------------------------------------------------------------
// Ordering by dragging
// ---------------------------------------------------------------------------
//
// The order is stored as `sort_order` on each document, and a drag has to turn "I dropped this here" into the
// numbers that mean that. Both helpers below are pure and return the `{id, sort_order}` pairs to save, because the
// rule is the part worth testing: whether dropping a document on another one puts it above or below, and what
// dragging a FOLDER is supposed to do. The component only sends what comes back.
//
// A folder has no row of its own - a folder is a name carried by the documents in it (see documentFolders) - so
// dragging a folder reorders whole BLOCKS of documents, and the folders then sort by the first document in each.
// That is why `reorderFolders` rewrites the order of every document in the folders it touches: it is the only
// thing there is to write.

// Step between neighbours. Gaps of 10 leave room for one more document between any two without renumbering the
// whole list, and the renumbering below only ever runs on the rows a drag actually touched.
const ORDER_STEP = 10;

// The documents of one folder, in the order they are shown. Exported because the editor's Move up / Move down
// buttons need the same sequence the list is drawn from: a touch screen does not fire HTML5 drag events at all, so
// dragging cannot be the only way to set a position.
export const orderedFolderDocuments = (documents, folder) =>
  (Array.isArray(documents) ? documents : [])
    .map(normalizeDocument)
    .filter((document) => documentFolder(document) === folder)
    .sort((a, b) => a.sort_order - b.sort_order || a.title.toLowerCase().localeCompare(b.title.toLowerCase()));

// The pairs to save for one folder's documents in their new order: the whole run numbered in steps, with the rows whose
// number did not move left out.
//
// SHARED BY BOTH KINDS OF DROP, deliberately. Dropping onto a row and dropping into the gap beside it are two ways of
// saying where something goes, and if each numbered the run itself the same visual position could save two different
// orders. The filter is also what makes a drag that ends where it started save NOTHING: every number matches what the
// row already holds, so the list comes back empty and the caller sends no request at all.
const numberedPairs = (list, ordered) =>
  ordered
    .map((document, index) => ({ id: document.id, sort_order: index * ORDER_STEP }))
    .filter((entry) => {
      const current = list.find((document) => document.id === entry.id);
      return !current || current.sort_order !== entry.sort_order;
    });

// Dropping `movedId` onto `targetId` places the moved document where the target was, and pushes the rest down.
// Dropping onto itself changes nothing, which is what makes a drag that goes nowhere harmless.
export const reorderDocuments = (documents, movedId, targetId) => {
  const moved = text(movedId);
  const target = text(targetId);
  if (!moved || !target || moved === target) return [];

  const list = (Array.isArray(documents) ? documents : []).map(normalizeDocument);
  const moving = list.find((document) => document.id === moved);
  const landing = list.find((document) => document.id === target);
  if (!moving || !landing) return [];

  // A drag never moves a document between folders: the folder is a field on the document, and dropping a row on a
  // row from another folder would silently move it. Reordering is about position, so the two have to agree.
  const within = orderedFolderDocuments(list, documentFolder(moving));
  if (documentFolder(moving) !== documentFolder(landing)) return [];

  const without = within.filter((document) => document.id !== moved);
  const at = without.findIndex((document) => document.id === target);
  if (at === -1) return [];

  // Which side of the target the row lands on is decided by the direction it travelled: dragging DOWN puts it
  // after the target, dragging UP puts it before it - which is where the row looks like it went. Taking the
  // target's index unconditionally would make a downward drag look like it did nothing.
  const movingDown = moving.sort_order < landing.sort_order;
  const next = movingDown ? at + 1 : at;
  const ordered = [...without.slice(0, next), moving, ...without.slice(next)];

  return numberedPairs(list, ordered);
};

// Dropping a document into the GAP between two others: immediately before `beforeId`, or at the end of the folder when
// `beforeId` is blank.
//
// THE OTHER HALF OF reorderDocuments, and the reason it is a second function rather than a flag on that one. Dropping ON
// a row can only place a document beside that row, and WHICH side is decided by the direction the drag travelled - right
// for a drag aimed at a row, and no use at all to an officer aiming at the space between two of them. A gap knows its
// own position, so this one takes the anchor instead of inferring a side: the gap above a document means exactly
// "before it", and the gap after the last document means "at the end". One function with a `side` argument would have to
// read the travel direction for one caller and ignore it for the other, which is how the two ends up disagreeing.
//
// `folder` is the folder the GAP BELONGS TO, and it is checked rather than assumed: the gap at the end of a run has no
// anchor to compare against, so without it a document dragged from another folder would be renumbered inside its own
// folder by a drop that looked like it landed somewhere else entirely.
export const insertDocumentBefore = (documents, movedId, folder, beforeId) => {
  const moved = text(movedId);
  const landing = text(folder);
  const anchor = text(beforeId);
  if (!moved || !landing) return [];

  const list = (Array.isArray(documents) ? documents : []).map(normalizeDocument);
  const moving = list.find((document) => document.id === moved);
  if (!moving) return [];
  // The same rule as dropping onto a row: a drag never moves a document between folders. `documentFolder` is what turns
  // a blank folder into the Unfiled shelf, which is the name the gap was built with.
  if (documentFolder(moving) !== landing) return [];

  const without = orderedFolderDocuments(list, moving.folder).filter((document) => document.id !== moved);
  // A blank anchor is the END of the run: there is no document to stop before, so the end of what is left IS the
  // position being asked for.
  const at = anchor === '' ? without.length : without.findIndex((document) => document.id === anchor);
  // An anchor that is not in this run - a gap belonging to another folder, or a row since deleted - is refused rather
  // than guessed at, which is the answer reorderDocuments gives for a target it cannot find.
  if (at === -1) return [];

  const ordered = [...without.slice(0, at), moving, ...without.slice(at)];
  return numberedPairs(list, ordered);
};

// A held list with a saved order applied to it: the rows already on screen, with the new `sort_order` on the ones that
// moved.
//
// WHY THE CLIENT APPLIES ITS OWN WRITE. A reorder answers with a COUNT (`{ moved }`), not with the library - and this
// screen used to redraw itself from `result.documents`, a field no writer returns. Reading a field that is not there is
// not an error: `normalizeDocumentList(undefined)` is `[]`, so the whole list vanished. The documents came back the
// moment the tab was left and reopened, because the WRITE had succeeded all along - which is what makes this worse than
// a failed save. A failed save says so; this looks like the library was emptied.
//
// THE PAIRS ARE THE SHEET'S ORDER, which is why applying them here is the same answer without a read: reorderDocuments
// and insertDocumentBefore number the whole run, and the writer skips nothing it was handed that still exists. The input
// list is never mutated, and an order that changes nothing returns the SAME list so React can skip the render - the rule
// utils/savedRow states for its own merges.
export const applyDocumentOrder = (documents, pairs) => {
  const list = Array.isArray(documents) ? documents : [];
  const wanted = new Map(
    (Array.isArray(pairs) ? pairs : [])
      .map((pair) => [text(pair && pair.id), Number.parseInt(pair && pair.sort_order, 10)])
      .filter(([id, order]) => id !== '' && Number.isFinite(order))
  );
  if (wanted.size === 0) return list;

  let changed = false;
  const patched = list.map((document) => {
    const order = wanted.get(text(document && document.id));
    if (order === undefined) return document;
    if (Number.parseInt(document && document.sort_order, 10) === order) return document;
    changed = true;
    return { ...document, sort_order: order };
  });
  return changed ? patched : list;
};

// The order a list is currently in, as `id -> sort_order`. The snapshot a pending change is measured against, and the
// numbers Discard puts back.
export const documentOrderSignature = (documents) => {
  const signature = new Map();
  (Array.isArray(documents) ? documents : []).forEach((document) => {
    const id = text(document && document.id);
    if (id) signature.set(id, Number.parseInt(document && document.sort_order, 10) || 0);
  });
  return signature;
};

// The pairs a save has to write: the rows whose number no longer matches the order they were last saved in.
//
// MEASURED AGAINST THE SAVED ORDER rather than against "did this row move". A drag that puts a document back where it
// was has nothing to write, and the bar offering to save it has to go away when it does - which only works if the
// question is "does this differ from what is stored" rather than "was this touched". This is also what lets the
// unsaved order be described by the pairs alone: the draft IS this list, so it cannot drift from what the screen shows.
//
// A ROW WITH NO SAVED NUMBER IS NOT PENDING, and it is worth saying why that is the safe way round. A number can only be
// missing when the row is not one the snapshot was built from - a state this screen is not in, since `rows` and the
// snapshot are set together from a single read. Reporting it as changed instead would mean a library nobody has touched
// offering to save every row in it, which is a worse answer to a question nobody asked. And it cannot lose a change: an
// officer can only drag a row that is on screen, and every row on screen has a number in the snapshot.
export const pendingDocumentOrderPairs = (documents, signature) => {
  const saved = signature instanceof Map ? signature : new Map();
  return (Array.isArray(documents) ? documents : [])
    .map((document) => ({
      id: text(document && document.id),
      sort_order: Number.parseInt(document && document.sort_order, 10) || 0,
    }))
    .filter((pair) => pair.id !== '' && saved.has(pair.id) && saved.get(pair.id) !== pair.sort_order);
};

// The saved order as pairs, so an unsaved change can be undone without a read: every number put back the way it was.
export const savedDocumentOrderPairs = (signature) =>
  [...(signature instanceof Map ? signature : new Map())].map(([id, sort_order]) => ({ id, sort_order }));

// Dragging a folder to another folder's position, as one block of documents. Writes nothing about the folder
// itself, because there is nothing to write: every document in the moved folder is given a place in the run.
export const reorderFolders = (documents, movedFolder, targetFolder) => {
  const moved = text(movedFolder);
  const target = text(targetFolder);
  if (!moved || !target || moved === target) return [];
  // Unfiled is where documents with no folder go, and it is pinned last by documentFolders: a drag cannot move a
  // folder after it, and cannot move it at all.
  if (moved === UNFILED_LABEL || target === UNFILED_LABEL) return [];

  const list = (Array.isArray(documents) ? documents : []).map(normalizeDocument);
  const folderOrder = documentFolders(list);
  const from = folderOrder.indexOf(moved);
  const to = folderOrder.indexOf(target);
  if (from === -1 || to === -1) return [];

  const without = folderOrder.filter((folder) => folder !== moved);
  const at = without.indexOf(target);
  // The same rule as dragging a document: down lands after the target, up lands before it.
  const movingDown = from < to;
  const next = movingDown ? at + 1 : at;
  const reordered = [...without.slice(0, next), moved, ...without.slice(next)];

  // Flatten each folder's documents, folder by folder, in the new order. Documents keep their order WITHIN a
  // folder and only the gaps between the blocks change, which is what makes a folder drag predictable.
  const flat = reordered.flatMap((folder) => orderedFolderDocuments(list, folder).map((document) => document.id));
  const wanted = new Map(flat.map((id, index) => [id, index * ORDER_STEP]));

  return list
    .filter((document) => wanted.has(document.id))
    .filter((document) => document.sort_order !== wanted.get(document.id))
    .map((document) => ({ id: document.id, sort_order: wanted.get(document.id) }));
};
// schedule's own (see utils/effectiveDates), reused rather than restated: the same two columns mean the same thing
// on both sheets, and a document does not need a second opinion about whether a date has passed.
export const documentLifecycle = (document, todayKey) => dateLifecycle(normalizeDocument(document), todayKey);

export const documentWindowLabel = (document) => dateWindowLabel(normalizeDocument(document));

// Whether members can see it today. The server decides this for the list it returns; the client asks the same
// question so that a document which retires while the module is open stops being offered as something to sign.
export const documentIsLive = (document, todayKey) => documentLifecycle(document, todayKey) === 'active';

// The folder a document is shown under.
export const documentFolder = (document) => normalizeDocument(document).folder || UNFILED_LABEL;

// Every folder in a list, A-Z with Unfiled last. Derived rather than stored: a folder with no documents does not
// exist, which is why nothing here can leave an empty folder behind.
// Every folder in a list, in the order the documents put them in. Unfiled is pinned last, because it is where the
// documents with no folder go rather than a folder anybody chose.
//
// The order is DRAGGABLE, so it cannot be alphabetical: a folder's place is its first document's `sort_order` (see
// reorderFolders), with the name breaking ties so two folders that share a number still come out in a stable order.
// A station that never drags anything still sees a sensible list - the documents were ordered when they were
// written, so the folders come out in the order their contents were created.
export const documentFolders = (documents) => {
  const list = (Array.isArray(documents) ? documents : []).map(normalizeDocument);
  const firstOrder = new Map();

  list.forEach((document) => {
    const folder = documentFolder(document);
    const current = firstOrder.get(folder);
    if (current === undefined || document.sort_order < current) firstOrder.set(folder, document.sort_order);
  });

  return [...firstOrder.keys()].sort((a, b) => {
    if (a === UNFILED_LABEL) return 1;
    if (b === UNFILED_LABEL) return -1;
    const diff = firstOrder.get(a) - firstOrder.get(b);
    if (diff !== 0) return diff;
    return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
  });
};

// The documents of one folder, in the order they are shown: `sort_order`, then title.
//
// THIS IS `orderedFolderDocuments`, AND IT USED TO NOT BE. It was a bare `.filter()` - the order the array happened to
// be in - while the SERVER sends the library sorted (`documentSort` in firestoreReads.js) and the drag helpers place
// rows using `orderedFolderDocuments`. Two answers to "what order is this list in", and the screen used the one that
// only a READ updates: a drop wrote the right numbers, the tab patched them onto its rows, and nothing moved. The new
// order appeared when the library was read again - which is to say after leaving the tab and coming back. That is the
// worst shape a bug can have: the save works, the screen does not, and the officer concludes the drag is broken.
//
// So the list is drawn through the same function the drag math uses. One definition, and a local change to `sort_order`
// moves a row on screen because the order on screen IS `sort_order`.
export const documentsInFolder = (documents, folder) => orderedFolderDocuments(documents, folder);

// Folder groups for the list, skipping any group the filter emptied. Each group's documents come from
// `documentsInFolder` above, so the rows under a heading are in screen order rather than in arrival order.
export const groupDocumentsByFolder = (documents) =>
  documentFolders(documents)
    .map((folder) => ({ folder, documents: documentsInFolder(documents, folder) }))
    .filter((group) => group.documents.length > 0);

// The folder column of the module's browser: every folder in the list, in the order the list shows them, with the
// two numbers that make the column worth having - how many documents are in it, and how many of those are waiting
// on THIS member's signature.
//
// Derived here rather than in the component because both numbers are rules, not layout: the count is of the
// documents the member was given (the server already filtered by rank and publication), and an outstanding
// signature is the same `documentSignatureState` the rows use. A folder that shows "2" must contain the same two
// documents the second column lists, or the browser is lying about its own contents.
export const folderSummaries = (documents, signatures, userId) =>
  groupDocumentsByFolder(documents).map((group) => ({
    folder: group.folder,
    count: group.documents.length,
    outstanding: group.documents.filter(
      (document) => documentSignatureState(document, signatures, userId) === 'outstanding'
    ).length,
  }));

// A free-text filter over the title and the folder. Deliberately not over the body: the list does not carry it
// (that is what keeps opening the module cheap), so promising to search it would be a lie.
export const filterDocuments = (documents, query) => {
  const needle = text(query).toLowerCase();
  if (!needle) return Array.isArray(documents) ? documents : [];
  return (Array.isArray(documents) ? documents : []).filter((document) => {
    const haystack = `${text(document.title)} ${documentFolder(document)}`.toLowerCase();
    return haystack.includes(needle);
  });
};

// "Updated 12 Mar 2026, 14:04" - the station-time format the System Log uses, from the same formatter, so the two
// screens cannot disagree about what a stored timestamp looks like.
//
// A document with no stamp gets nothing rather than the formatter's own placeholder: the absence of a date is not
// news, and "Updated —" would be.
export const documentUpdatedLabel = (document, timeFormat = '12') => {
  const updatedAt = normalizeDocument(document).updated_at;
  if (!updatedAt) return '';
  const stamp = formatLogTimestamp(updatedAt, timeFormat);
  return stamp ? `Updated ${stamp}` : '';
};

// A checklist's items. The shape lives here rather than in checklists.js so `normalizeDocument` can normalize its
// own items - the arithmetic ABOUT those items is in checklists.js, which imports this.
//
// `sort_order` is the author's order and ties broken by label, so two items deliberately put in the same slot do
// not swap places between reads.
export const normalizeChecklistItem = (row) => {
  const source = row || {};
  const order = Number.parseInt(source.sort_order, 10);
  return {
    id: text(source.id),
    document_id: text(source.document_id),
    sort_order: Number.isFinite(order) ? order : 0,
    section: text(source.section),
    label: text(source.label),
  };
};

// The Order box on a checklist item, as the number to store.
//
// WHY THIS EXISTS AT ALL: the box used to hold a NUMBER whose empty state was `0`, so "left blank" and "typed 0" were
// the same value and the save could only separate them with `Number(value) || auto`. `Number('0')` IS 0 - falsy - so an
// item an author deliberately put at order 0 fell through and was silently renumbered into the next vacant slot (10, 20,
// ...). The order an author types is the one thing this field is for, so it is not a value the app may substitute its
// own for. The box therefore holds TEXT, where blank and '0' are different answers, and this is where that difference is
// turned into a number: a blank box takes the fallback, and anything else is the number it says.
//
// The widget may hold an empty string, a partially typed number, or a real one; what it must never do is invent a
// value for a box somebody filled in.
export const checklistItemSortOrder = (rawValue, fallback = 0) => {
  const raw = text(rawValue);
  if (raw === '') return fallback;
  // PARSED THE WAY IT IS READ BACK. `normalizeChecklistItem` uses parseInt, so parsing the same text as a decimal here
  // is what keeps the number saved equal to the number shown after the save - a typed '1e3' would otherwise write 1000
  // and read back as 1, and the row would change the moment it was reloaded.
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

export const normalizeChecklistItemList = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map(normalizeChecklistItem)
    .filter((item) => item.id !== '')
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));

// The rows the administrator's item card draws, each with whether it is stored yet.
//
// ONE ANSWER, IN ONE PLACE. Three things on that card have to agree about what the list holds - the count beside the
// heading, the "no items yet" line, and the rows themselves - and they each worked it out separately from
// `items.length + stagedItems.length`. That is why the fault this rule exists for reached the screen in all three at
// once, and it is why the rule is stated here rather than inline at each of them.
//
// The rule: `items` are the rows OF THE DOCUMENT BEING EDITED, read from the server, so a document that does not exist
// yet has none - a new checklist shows only what the author has typed into it. That is true by construction once the
// editor blanks its own state as it opens (see `AdminDocumentsTab#resetEditorState`), and it is asserted here as well,
// because THIS is the line a leak shows through rather than a line that causes one.
//
// The reported fault, to be exact about what changed: the tab kept the previous checklist's `items` through "New
// document", whose form has no id and therefore never re-reads them. A saved checklist's rows were drawn under the new
// one - and marked "not saved yet", because a document with no id has no stored rows. Nothing was written from them
// (an item save needs `form.id`, and the create-time flush reads only the staged list), so this was a screen that
// lied rather than a row that landed in the wrong document - but the screen is what the officer is deciding from.
//
// Staged items keep the order they were typed in; they are not re-sorted by `sort_order`. The stored ones arrive
// already in screen order from the server, and the two runs are drawn one after the other, so sorting the second would
// order it by a number the author has not necessarily seen yet - and would break the one thing staging is for, which
// is that the list looks like what was just typed.
export const editorChecklistItemRows = (items, stagedItems, isEditing) => {
  const stored = isEditing && Array.isArray(items) ? items : [];
  const staged = Array.isArray(stagedItems) ? stagedItems : [];
  return [
    ...stored.map((item) => ({ item, staged: false })),
    ...staged.map((item) => ({ item, staged: true })),
  ];
};

export const EMPTY_DOCUMENT_FORM = {
  id: '',
  row_version: '',
  title: '',
  folder: '',
  doc_type: 'markdown',
  sort_order: 0,
  content: '',
  is_published: true,
  rank_id: '',
  is_sign_required: false,
  // The window, from the same two columns the schedule uses: to start a document on a date and retire it on a date
  // without deleting it. Blank means no restriction, so every document written before these fields existed is live
  // forever, exactly as it behaved before.
  effective_date: '',
  end_date: '',
};

// The form's view of a saved document.
export const documentToForm = (document) => {
  const normalized = normalizeDocument(document);
  return {
    id: normalized.id,
    row_version: normalized.row_version,
    title: normalized.title,
    folder: normalized.folder,
    doc_type: normalized.doc_type,
    sort_order: normalized.sort_order,
    content: normalized.content,
    is_published: normalized.is_published,
    rank_id: normalized.rank_id,
    is_sign_required: normalized.is_sign_required,
    effective_date: normalized.effective_date,
    end_date: normalized.end_date,
    // Read-only, for the "Created by" and "Updated" lines: never sent back by a save.
    author_user_id: normalized.author_user_id,
    updated_at: normalized.updated_at,
  };
};

// The client half of the server's validation, so the author is told before the request rather than by a refusal
// afterwards. The server checks the same things and is the authority; this only saves the round trip.
export const documentSaveProblem = (form) => {
  if (!text(form?.title)) return 'A title is required.';

  // A link is an address and nothing else. Checked here as well as on the server: the server is what makes it
  // true, and this is what tells the author before they press Save.
  if (form?.doc_type === 'link') {
    const linkProblem = documentLinkProblem(form?.content);
    if (linkProblem) return linkProblem;
  } else if (String(form?.content ?? '').length > DOCUMENT_CONTENT_LIMIT) {
    return `This document is longer than the sheet can hold (the limit is ${DOCUMENT_CONTENT_LIMIT.toLocaleString(
      'en-US'
    )} characters). Split it into two documents.`;
  }

  // The same rules the server applies, from the same helper the schedule uses, so a refusal here and a refusal
  // there cannot disagree about what a readable date is.
  const dateProblem = dateWindowError(form?.effective_date, form?.end_date);
  if (dateProblem) return dateProblem;

  return '';
};

// How many characters are left, for the editor's counter. Negative means over the limit, which the counter shows
// rather than hiding - an author needs to know how far over they are.
export const documentCharactersLeft = (content) => DOCUMENT_CONTENT_LIMIT - String(content ?? '').length;

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------
// The client's view of what a member has signed. The server sends only that member's own rows (their signatures,
// and the verifier rows recorded about them), so nothing here filters by member - it is about turning those rows
// into the two answers the module needs: "have I signed this?" and "what still needs me?".



export const normalizeSignature = (row) => {
  const source = row || {};
  const role = text(source.signature_role).toLowerCase();
  const revision = Number.parseInt(source.content_revision, 10);
  return {
    id: text(source.id),
    document_id: text(source.document_id),
    checklist_item_id: text(source.checklist_item_id),
    user_id: text(source.user_id),
    signed_by_user_id: text(source.signed_by_user_id),
    signature_role: role === 'verifier' ? 'verifier' : 'member',
    signed_at: text(source.signed_at),
    content_revision: Number.isFinite(revision) ? revision : 0,
    stale: source.stale === true || text(source.stale).toUpperCase() === 'TRUE',
    // Whether an officer entered this from the paper file rather than the member ticking it. Carried through
    // normalization like every other field, so no screen has to reach past it to the raw row to tell the difference.
    backfilled: source.backfilled === true || text(source.backfilled).toUpperCase() === 'TRUE',
    backfilled_at: text(source.backfilled_at),
    backfill_note: text(source.backfill_note),
  };
};

export const normalizeSignatureList = (rows) =>
  (Array.isArray(rows) ? rows : []).map(normalizeSignature).filter((signature) => signature.id !== '');

// This member's own whole-document signature for one document, or null. Only their own 'member' rows count: a
// verifier's acknowledgment of their checklist is not their signature.
export const memberSignatureFor = (signatures, documentId, userId) =>
  normalizeSignatureList(signatures).find(
    (signature) =>
      signature.document_id === text(documentId) &&
      signature.checklist_item_id === '' &&
      signature.signature_role === 'member' &&
      signature.user_id === text(userId)
  ) || null;

// Every document this member has signed, as a Set of ids.
export const signedDocumentIds = (signatures, userId) => {
  const ids = new Set();
  normalizeSignatureList(signatures).forEach((signature) => {
    if (signature.checklist_item_id !== '') return;
    if (signature.signature_role !== 'member') return;
    if (signature.user_id !== text(userId)) return;
    ids.add(signature.document_id);
  });
  return ids;
};

// What the module shows beside a document. Three states rather than a boolean, because "does not need a
// signature" and "not signed yet" are different things to a reader - and the middle one is the only one that is
// asking them for something.
export const documentSignatureState = (document, signatures, userId) => {
  const normalized = normalizeDocument(document);

  // A checklist is signed ITEM BY ITEM, so its state is read from its items: "signed" means there is nothing left
  // for this member to tick. Its `is_sign_required` flag is always true (the server forces it for the type), so
  // testing the flag alone - as the branch below does for everything else - would mark every checklist as
  // outstanding forever, now that a checklist can no longer take a signature of its own.
  if (normalized.doc_type === 'checklist') {
    // A checklist with no items is not a task anybody can be waiting on.
    if (normalized.item_count === 0) return 'not-required';
    return normalized.items_signed >= normalized.item_count ? 'signed' : 'outstanding';
  }

  if (!normalized.is_sign_required) return 'not-required';
  return signedDocumentIds(signatures, userId).has(normalized.id) ? 'signed' : 'outstanding';
};

// The documents still waiting on this member: published ones they can see that need a signature they have not
// given. This is the "needs your signature" counter and filter.
export const outstandingSignatureDocuments = (documents, signatures, userId) =>
  (Array.isArray(documents) ? documents : []).filter(
    (document) => documentSignatureState(document, signatures, userId) === 'outstanding'
  );

// "Signed 12 Mar 2026, 14:04" - the stored stamp is the server's Eastern timestamp, so it is formatted by the
// same helper the System Log uses rather than a second parser.
// "Signed Sat, Mar 14 2026". The prefix is a parameter because a back-filled row is not something anybody signed: the
// same formatter says "Recorded Sat, Mar 14 2026" for it rather than a second one being written beside this, which is
// how two dates end up formatted differently on the same screen.
export const signatureDateLabel = (signature, timeFormat = '12', prefix = 'Signed') => {
  const signedAt = normalizeSignature(signature).signed_at;
  if (!signedAt) return '';
  const stamp = formatLogTimestamp(signedAt, timeFormat);
  return stamp ? `${prefix} ${stamp}` : '';
};

// The same date, said the way a back-filled row should: "Recorded Thu, May 1 2025". A no-op on a row the member signed
// themselves, so a caller that does not want to think about the difference can just call this.
export const signatureRecordedLabel = (signature, timeFormat = '12') =>
  signatureIsBackfilled(signature) ? signatureDateLabel(signature, timeFormat, 'Recorded') : '';

// Whether a signature is older than the document it is on. The server decides this for the report; the module
// uses the same flag for the member's own signature, so both screens agree.
export const signatureIsStale = (signature) => normalizeSignature(signature).stale;

// ---------------------------------------------------------------------------
// GRANDFATHERING: signatures recorded for a member, by an officer, from the paper file
// ---------------------------------------------------------------------------
// Somebody who did the work before this app existed has no row anywhere, and asking them to tick forty boxes they
// already did on paper is not "recording the station's history" - it is typing practice. So an administrator can enter
// what the paper file says, for many items and many people, and the row that lands is honest about it in three ways:
//
//   - `user_id` is the MEMBER it counts for, so every screen that reads progress, badges or completion keeps working
//     unchanged. That is deliberate, and it is why this is not a fourth `signature_role`: a role nothing else
//     recognises would leave the member's checklist still reading "outstanding", which defeats the whole point.
//   - `signed_by_user_id` is the OFFICER who entered it. The field already existed for exactly this distinction.
//   - `backfilled` is true, with the note and the moment of entry beside it - so "the member ticked this in the app" and
//     "an officer copied this off a sheet of paper" can never be confused by anybody reading the record later.
//
// A back-filled row is therefore a member's signature in every arithmetic sense and a different STATEMENT in every
// human sense, and the screens say which one it is.
export const BACKFILL_NOTE_LIMIT = 200;

// Whether this row was entered by somebody else rather than by the member themselves.
//
// ONLY A 'member' ROW CAN BE A BACK-FILL, and that is the first thing this checks. A verifier's row also has a signer
// that is not its owner - that is its whole design - so a test that only looked at those two fields would report every
// verification as a back-filled signature and label it wrongly on screen.
//
// TWO READINGS beyond that, on purpose. The stored flag is the truth for a row written by this app. The fallback - a
// 'member' row whose signer is not its owner - catches rows that predate the flag, and it is not a guess: it is the one
// shape the rules always refused for a member, so a row with it can only have come from an officer. Older data
// therefore reads correctly with no migration, and the screens tell the truth about it either way.
export const signatureIsBackfilled = (signature) => {
  const row = normalizeSignature(signature);
  if (row.signature_role !== 'member') return false;
  if (row.backfilled) return true;
  return row.signed_by_user_id !== '' && row.signed_by_user_id !== row.user_id;
};

// "Recorded by Jane Doe for Ana Ruiz" - who entered it, and whose record it is.
//
// The labels are passed in rather than looked up, because this module is pure and has no directory: every screen that
// shows a signature already has the users list, and resolving a name here would be a second, worse lookup.
export const backfilledSignatureLabel = (signature, memberLabel = '', signerLabel = '') => {
  const row = normalizeSignature(signature);
  if (!signatureIsBackfilled(row)) return '';
  const recorded = signerLabel ? `Recorded by ${signerLabel}` : 'Recorded from paper records';
  return memberLabel ? `${recorded} for ${memberLabel}` : recorded;
};

// ONE ITEM, for one member, as the back-fill screen draws it: whether it is already accounted for, and in what way.
//
// `recorded` covers both halves deliberately - a member who signed it themselves in the app and one an officer entered
// from paper are both already accounted for, so the screen leaves them alone and the officer sees the difference in the
// wording rather than in whether the cell can be clicked.
export const backfillItemState = (item, signatures, memberId) => {
  const wantedItem = text(item && item.id !== undefined ? item.id : item);
  const wantedUser = text(memberId);
  const mine = normalizeSignatureList(signatures).filter(
    (signature) => signature.checklist_item_id === wantedItem && signature.user_id === wantedUser
  );
  const member = mine.find((signature) => signature.signature_role === 'member') || null;
  const verified = mine.filter((signature) => signature.signature_role === 'verifier');

  return {
    itemId: wantedItem,
    // Already on file - by the member, or by an officer from paper.
    recorded: member !== null,
    backfilled: member ? signatureIsBackfilled(member) : false,
    signedByMember: member !== null && !signatureIsBackfilled(member),
    recordedAt: member ? member.signed_at : '',
    recordedByUserId: member ? member.signed_by_user_id : '',
    verified: verified.length > 0,
  };
};

export const backfillItemStates = (items, signatures, memberId) =>
  normalizeChecklistItemList(items).map((item) => ({
    item,
    ...backfillItemState(item, signatures, memberId),
  }));

// THE IDS A SAVE SHOULD WRITE: the ones the officer ticked, that this document owns, and that are not already on file.
//
// SHARED BY THE SCREEN AND THE WRITER, which is the point of it being here. The screen counts what is about to be
// written; the writer decides what to persist. If each worked it out separately they could disagree, and the failure
// would be a count saying four beside a write that makes three - or, worse, a second row for an item somebody had
// already signed. Duplicates are collapsed here, so a double tick cannot become two rows.
export const backfillableItemIds = (items, signatures, memberId, wantedIds) => {
  const wanted = (Array.isArray(wantedIds) ? wantedIds : []).map((id) => text(id)).filter(Boolean);
  if (!wanted.length) return [];

  const owned = new Set(normalizeChecklistItemList(items).map((item) => item.id));
  const onFile = new Set(
    normalizeSignatureList(signatures)
      .filter(
        (signature) =>
          signature.user_id === text(memberId) &&
          signature.signature_role === 'member' &&
          signature.checklist_item_id !== ''
      )
      .map((signature) => signature.checklist_item_id)
  );

  return [...new Set(wanted)].filter((id) => owned.has(id) && !onFile.has(id));
};

// The rows a back-fill should create, as DATA rather than as writes - so the record can be asserted without an
// emulator, and the writer only has to persist what this returns.
//
// `confirmVerified` adds the verifier's row for each one, attributed to the SAME officer. That is not an officer
// verifying their own checklist (which the server refuses): it is the officer who copied the paper file saying "and I am
// confirming what I just entered", which is what the supervisor's signature on the paper meant in the first place. It is
// a visible choice rather than a default buried in the code, because a station that keeps a second pair of eyes on
// grandfathering can turn it off and let these go to the ordinary verification queue.
export const backfillSignaturePlan = ({
  documentId,
  items,
  signatures,
  memberId,
  recorderId,
  itemIds,
  at,
  revision = 0,
  note = '',
  confirmVerified = false,
}) => {
  const document = text(documentId);
  const member = text(memberId);
  const recorder = text(recorderId);
  const stamp = text(at);
  const trimmedNote = text(note).slice(0, BACKFILL_NOTE_LIMIT);
  const pending = backfillableItemIds(items, signatures, member, itemIds);
  const contentRevision = Number.parseInt(revision, 10) || 0;

  const shared = {
    // THE DOCUMENT IS THE ONE FIELD THAT MUST NOT BE MISSED, and it is worth saying because it was: a signature row
    // without `document_id` is attached to nothing - every screen reads signatures BY DOCUMENT, so the row exists, the
    // write reports success, and the item still reads as unrecorded. The emulator round trip caught it; the pure test
    // did not, because it was asserting the fields it knew about rather than that the row was whole.
    document_id: document,
    user_id: member,
    signed_by_user_id: recorder,
    signed_at: stamp,
    backfilled: true,
    backfilled_at: stamp,
    backfill_note: trimmedNote,
    // The revision the document is AT as the officer records this, which is the honest stamp: these rows are being
    // entered now, against the checklist as it reads today. It also means a back-fill is never reported as stale, which
    // is right - nobody signed different words, there were no words.
    content_revision: contentRevision,
  };

  return {
    itemIds: pending,
    member: pending.map((itemId) => ({ ...shared, checklist_item_id: itemId, signature_role: 'member' })),
    verifier: confirmVerified
      ? pending.map((itemId) => ({
          document_id: document,
          checklist_item_id: itemId,
          user_id: member,
          signed_by_user_id: recorder,
          signature_role: 'verifier',
          signed_at: stamp,
          // A verification is not a signature OF a revision - see verifyChecklistItem - and it is not the back-fill of
          // one either, so it carries neither the revision nor the flag.
          content_revision: 0,
        }))
      : [],
  };
};

// THE MEMBERS A BACK-FILL CAN BE RECORDED FOR: everybody except the officer doing the recording.
//
// It is a rule rather than a filter in a dropdown, and it is here because it is the client half of a refusal the server
// also makes - "a back-fill is somebody else recording what they found". Leaving the officer's own name in the list
// would be offering a save that always fails, and the two halves have to agree about who is eligible.
//
// It was a line inside the component's `useMemo` until a mutation test showed the gap: a text check for the expression
// passes as long as the expression is still there, so prefixing it with `false &&` broke the behaviour and left every
// check green. As a function with cases, the rule itself is what is asserted.
export const backfillCandidates = (users, recorderId) => {
  const recorder = text(recorderId);
  return (Array.isArray(users) ? users : []).filter((user) => {
    const id = text(user && user.id);
    return id !== '' && id !== recorder;
  });
};

// ---------------------------------------------------------------------------
// Assessment scores
// ---------------------------------------------------------------------------
// A score is one member's result on one assessment: a STRING the station chose the wording of ("Pass", "4:52", "12/15",
// or free text), and the day it was recorded.
//
// A STRING, DELIBERATELY, and not a number. Every assessment in this app scores something different - a time, a count, a
// mark out of ten, a pass/fail - and a number would force each one to invent a unit and a scale that mean nothing across
// the list. Sorting and arithmetic are not what a station does with these; reading back what was written last is.
// `normalizeAssessmentScore` therefore never parses it as a number, and nothing here sorts by it.
//
// ONE CURRENT SCORE PER MEMBER PER ASSESSMENT, not a history: the document id is `{documentId}_{userId}`, so a second
// save REPLACES the first. That is the reading of "a single input field for a score", and it is worth knowing that
// re-testing the same member overwrites what was there.

export const assessmentScoreLimit = 200;

// The document id for one member's score on one assessment. The member is IN the id, which is what lets the rule prove
// whose score it is without reading anything else - the same convention as `availability_months/{uid}_{YYYY-MM}`.
export const assessmentScoreId = (documentId, userId) =>
  `${String(documentId ?? '').trim()}_${String(userId ?? '').trim()}`;

export const normalizeAssessmentScore = (row) => {
  const source = row || {};
  return {
    id: text(source.id),
    document_id: text(source.document_id),
    user_id: text(source.user_id),
    // Kept as written and trimmed only. NOT parsed: see the note above on why a score is a string.
    score: text(source.score),
    scored_on: effectiveDateKey(source.scored_on),
    scored_by_user_id: text(source.scored_by_user_id),
    updated_at: text(source.updated_at),
  };
};

export const normalizeAssessmentScoreList = (rows) =>
  (Array.isArray(rows) ? rows : []).map(normalizeAssessmentScore).filter((score) => score.id !== '');

// One member's score for one document, or null. Scoped to a single member deliberately: the reader is shown their own,
// and the officer's lookup names the member explicitly, so no screen can accidentally render the whole crew's scores.
export const memberAssessmentScore = (scores, documentId, userId) =>
  normalizeAssessmentScoreList(scores).find(
    (score) => score.document_id === text(documentId) && score.user_id === text(userId)
  ) || null;

// "Scored 12 Mar 2026". The date is a plain 'YYYY-MM-DD' the officer typed, so it is formatted as a date rather than
// through the server-timestamp helper `signatureDateLabel` uses - these are different kinds of stamp and reading one
// with the other's formatter is how a date comes out as a time.
export const assessmentScoreDateLabel = (score) => {
  const on = normalizeAssessmentScore(score).scored_on;
  return on ? `Scored ${on}` : '';
};

// The client half of the server's validation, so the officer is told before the request rather than by a refusal. A
// score may be any text within the limit - but it may not be EMPTY, because an empty row is indistinguishable from a
// member who has never been scored, and that is exactly the ambiguity this feature exists to remove.
export const assessmentScoreProblem = (score) => {
  const value = text(score);
  if (!value) return 'Enter a score.';
  if (value.length > assessmentScoreLimit) {
    return `That score is too long (the limit is ${assessmentScoreLimit} characters).`;
  }
  return '';
};
