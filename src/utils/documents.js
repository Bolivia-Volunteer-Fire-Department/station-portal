// Documents: the shapes and the pure decisions the member module and the administration tab share.
//
// The server owns the rules that decide ACCESS (published, and at or above the member's rank) and returns the
// list already in order. What lives here is everything about how a READER sees it: the folder groups, the search
// filter, the row shape, and the client half of the save validation. Pure and dependency-free, so it is testable
// without a browser - see scripts/verify-documents.mjs.

import { formatLogTimestamp } from './systemLog';

// The two kinds of document. `markdown` is free text with formatting; `checklist` adds items signed one at a
// time. Anything unrecognized reads as markdown rather than as an empty screen.
export const DOCUMENT_TYPES = ['markdown', 'checklist'];

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

  return {
    id: text(source.id),
    title: text(source.title),
    folder: text(source.folder),
    doc_type: DOCUMENT_TYPES.includes(requestedType) ? requestedType : 'markdown',
    sort_order: Number.isFinite(order) ? order : 0,
    is_published: source.is_published === true || text(source.is_published).toUpperCase() === 'TRUE',
    rank_id: text(source.rank_id),
    is_sign_required: source.is_sign_required === true || text(source.is_sign_required).toUpperCase() === 'TRUE',
    content_revision: Number.isFinite(revision) ? revision : 0,
    content_length: Number.isFinite(length) ? length : 0,
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

// The folder a document is shown under.
export const documentFolder = (document) => normalizeDocument(document).folder || UNFILED_LABEL;

// Every folder in a list, A-Z with Unfiled last. Derived rather than stored: a folder with no documents does not
// exist, which is why nothing here can leave an empty folder behind.
export const documentFolders = (documents) => {
  const names = new Set((Array.isArray(documents) ? documents : []).map(documentFolder));
  return [...names].sort((a, b) => {
    if (a === UNFILED_LABEL) return 1;
    if (b === UNFILED_LABEL) return -1;
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
    // Read-only, for the "Created by" and "Updated" lines: never sent back by a save.
    author_user_id: normalized.author_user_id,
    updated_at: normalized.updated_at,
  };
};

// The client half of the server's validation, so the author is told before the request rather than by a refusal
// afterwards. The server checks the same things and is the authority; this only saves the round trip.
export const documentSaveProblem = (form) => {
  if (!text(form?.title)) return 'A title is required.';
  if (String(form?.content ?? '').length > DOCUMENT_CONTENT_LIMIT) {
    return `This document is longer than the sheet can hold (the limit is ${DOCUMENT_CONTENT_LIMIT.toLocaleString(
      'en-US'
    )} characters). Split it into two documents.`;
  }
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
