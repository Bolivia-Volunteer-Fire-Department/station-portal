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

  return ordered
    .map((document, index) => ({ id: document.id, sort_order: index * ORDER_STEP }))
    .filter((entry) => {
      const current = list.find((document) => document.id === entry.id);
      return !current || current.sort_order !== entry.sort_order;
    });
};

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

// The documents of one folder, in the order the server sent them (its own `sort_order`, then title).
export const documentsInFolder = (documents, folder) =>
  (Array.isArray(documents) ? documents : []).filter((document) => documentFolder(document) === folder);

// Folder groups for the list, skipping any group the filter emptied.
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

export const normalizeChecklistItemList = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map(normalizeChecklistItem)
    .filter((item) => item.id !== '')
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));

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
export const signatureDateLabel = (signature, timeFormat = '12') => {
  const signedAt = normalizeSignature(signature).signed_at;
  if (!signedAt) return '';
  const stamp = formatLogTimestamp(signedAt, timeFormat);
  return stamp ? `Signed ${stamp}` : '';
};

// Whether a signature is older than the document it is on. The server decides this for the report; the module
// uses the same flag for the member's own signature, so both screens agree.
export const signatureIsStale = (signature) => normalizeSignature(signature).stale;

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
