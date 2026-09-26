/**
 * Verifies the Documents feature: the rules in Code.gs, the actions that expose them, and the two screens.
 *
 * What this exists for: a documents library is mostly quiet failure. A rank filter comparing the wrong direction
 * hides a document from the people who need it; a list that ships the body anyway looks fine on a small library
 * and turns an SOP shelf into a slow screen; a revision that increments on a rename makes every signature look
 * stale. None of those break the build, and none of them look wrong in a screenshot.
 *
 * So the rules are RUN rather than read: the document functions are evaluated out of the real Code.gs against a
 * fake workbook (the technique verify-bootstrap uses), and the screens are rendered headlessly. What can only be
 * read - which action is gated on what - is checked as source, and labeled as such.
 *
 *   npm run verify:documents
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToString } from 'react-dom/server';
import MarkdownEditor from '../src/components/MarkdownEditor.jsx';
import DocumentsModule from '../src/components/DocumentsModule.jsx';
import AdminDocumentsTab from '../src/components/admin/AdminDocumentsTab.jsx';
import { ADMIN_PERMISSIONS, allowedAdminTabs, permissionTab } from '../src/utils/permissions.js';
import { ADMIN_BAR_LABELS, PAGE_BAR_LABELS } from '../src/utils/pageLabels.js';
import {
  DOCUMENT_CONTENT_LIMIT,
  UNFILED_LABEL,
  documentCharactersLeft,
  documentFolders,
  documentSaveProblem,
  documentSignatureState,
  documentToForm,
  documentUpdatedLabel,
  filterDocuments,
  folderSummaries,
  groupDocumentsByFolder,
  isChecklist,
  memberSignatureFor,
  normalizeChecklistItemList,
  normalizeDocumentList,
  outstandingSignatureDocuments,
  signatureDateLabel,
  signatureIsStale,
  signedDocumentIds,
} from '../src/utils/documents.js';
import {
  UNNAMED_SECTION,
  checklistIsComplete,
  checklistItemState,
  checklistItemStates,
  checklistProgress,
  checklistProgressLabel,
  checklistSections,
  membersAwaitingVerification,
  verificationQueue,
} from '../src/utils/checklists.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

// ---------------------------------------------------------------------------
// The real Code.gs, evaluated with Apps Script stubbed out
// ---------------------------------------------------------------------------
const sheets = {};
const addSheet = (name, rows) => {
  sheets[name] = rows.map((row) => row.slice());
};

// Enough of a sheet for the document helpers: read a range, write one back, append, and the column count
// `ensureSheetHeaders` uses to decide whether it is looking at a real header row.
//
// `setValues` really writes, because "the sheet creates its own header row" is one of the claims under test - a
// no-op stub would make that pass or fail for reasons of its own. It ignores the range coordinates and writes
// from A1, which is where every write in this feature starts.
// Enough of a range for the document helpers: read a window, write one back, and report its width.
//
// The coordinates are HONORED, which matters once a helper writes a single row: `upsertSheetRowById` writes back
// the row it found, and a stub that always wrote from A1 would overwrite the header with it - a failure that looks
// like the feature losing its own rows. `setValue`/`setValues` therefore write from the given corner, and clear
// exactly the cells they are given, as Sheets does.
const rangeStub = (name, row, col, numRows, numCols) => {
  const startRow = row ? row - 1 : 0;
  const startCol = col ? col - 1 : 0;
  const window = () =>
    sheets[name]
      .slice(startRow, numRows === undefined ? undefined : startRow + numRows)
      .map((line) => line.slice(startCol, numCols === undefined ? undefined : startCol + numCols));

  return {
    getValues: () => window(),
    getDisplayValues: () => window().map((line) => line.map((cell) => String(cell))),
    setValue: (value) => {
      if (!sheets[name][startRow]) sheets[name][startRow] = [];
      sheets[name][startRow][startCol] = value;
    },
    setValues: (values) => {
      values.forEach((line, index) => {
        const target = startRow + index;
        if (!sheets[name][target]) sheets[name][target] = [];
        line.forEach((cell, cellIndex) => {
          sheets[name][target][startCol + cellIndex] = cell;
        });
      });
    },
  };
};

const sheetStub = (name) => ({
  getDataRange: () => rangeStub(name),
  getRange: (row, col, numRows, numCols) => rangeStub(name, row, col, numRows, numCols),
  getLastColumn: () => (sheets[name][0] || []).length,
  // Needed by ensureRowVersionColumn, which appends the row_version column to a sheet that predates it - the same
  // path a real station's sheet takes on its first write after an upgrade.
  getLastRow: () => sheets[name].length,
  appendRow: (row) => sheets[name].push(row.slice()),
});

const ss = {
  getSheetByName: (name) => (sheets[name] ? sheetStub(name) : null),
  insertSheet: (name) => {
    addSheet(name, []);
    return sheetStub(name);
  },
  getName: () => 'Fake spreadsheet',
};

const noop = () => {};
const propertyStore = new Map();
const pad2 = (n) => String(n).padStart(2, '0');
const codeSource = readFileSync(path.resolve(process.cwd(), 'src/services/Code.gs'), 'utf8');

let code;
try {
  code = new Function(
    'SpreadsheetApp',
    'PropertiesService',
    'CacheService',
    'LockService',
    'Utilities',
    'Logger',
    'Session',
    'UrlFetchApp',
    'ContentService',
    'Base64',
    'console',
    `${codeSource}
     return { documentFieldsFrom, documentValidationError, documentMeetsRank, documentListRow, documentItemRows,
       documentFullRow, memberDocumentRows, documentListSort, documentRevisionFor, documentSignatureCount,
       documentSheet, ensureSheetHeaders, DOCUMENT_HEADERS, DOCUMENT_CONTENT_LIMIT, getSheetData,
       normalizeDocumentSignature, documentSignatureRows, documentSignaturesForUser, documentSignaturesForDocument,
       documentSignatureFor, signatureIsStale,
       checklistItemFieldsFrom, checklistItemValidationError, checklistItemById, checklistItemSignatures,
       checklistItemIsSigned, checklistItemSheet, bumpDocumentRevision };`
  )(
    { getActiveSpreadsheet: () => ss },
    {
      getScriptProperties: () => ({
        getProperty: (key) => (propertyStore.has(key) ? propertyStore.get(key) : null),
        setProperty: (key, value) => propertyStore.set(key, value),
        deleteProperty: (key) => propertyStore.delete(key),
      }),
    },
    { getScriptCache: () => ({ get: () => null, put: noop, remove: noop }) },
    { getScriptLock: () => ({ tryLock: () => true, releaseLock: noop }) },
    {
      formatDate: (value) => {
        const date = value instanceof Date ? value : new Date(value);
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
      },
      getUuid: () => '00000000-0000-4000-8000-000000000001',
    },
    { log: noop },
    { getActiveUser: () => ({ getEmail: () => 'test@example.com' }) },
    { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }) },
    { createTextOutput: () => ({ setMimeType: () => ({}) }) },
    { encode: (value) => value, decode: (value) => value },
    { log: noop, warn: noop, error: noop }
  );
} catch (error) {
  checkIs('Code.gs evaluates with Apps Script stubbed', false, `${error.name}: ${error.message}`);
  process.exit(1);
}

// The station's ranks, and a library covering the cases that matter: an unrestricted document, one for Officers,
// one draft, and one checklist.
addSheet('ranks', [
  ['id', 'description', 'rank_order'],
  ['rank-ff', 'Firefighter', 1],
  ['rank-driver', 'Driver', 2],
  ['rank-officer', 'Officer', 3],
]);

const DOCUMENT_ROW = (over) =>
  Object.assign(
    {
      id: '',
      title: '',
      folder: '',
      doc_type: 'markdown',
      sort_order: 0,
      content: '',
      is_published: 'TRUE',
      rank_id: '',
      is_sign_required: 'FALSE',
      content_revision: 1,
      author_user_id: 'user-admin',
      updated_at: '2026-03-12 09:00:00',
    },
    over
  );

const HEADERS = Object.keys(DOCUMENT_ROW({}));
addSheet('documents', [
  HEADERS,
  Object.values(DOCUMENT_ROW({ id: 'doc-open', title: 'Station roster', folder: 'General', content: 'Who is on duty.' })),
  Object.values(
    DOCUMENT_ROW({
      id: 'doc-officer',
      title: 'Officer duties',
      folder: 'General',
      sort_order: 1,
      content: 'Officer-only procedure.',
      rank_id: 'rank-officer',
      is_sign_required: 'TRUE',
      content_revision: 2,
    })
  ),
  Object.values(
    DOCUMENT_ROW({ id: 'doc-draft', title: 'Unfinished policy', content: 'Half written.', is_published: 'FALSE' })
  ),
  Object.values(
    DOCUMENT_ROW({
      id: 'doc-checklist',
      title: 'Driver checklist',
      folder: 'Apparatus',
      doc_type: 'checklist',
      content: 'Complete before every shift.',
      is_sign_required: 'TRUE',
    })
  ),
  // Published with no folder, so the "Unfiled last" rule is exercised by a document a member really sees.
  Object.values(DOCUMENT_ROW({ id: 'doc-unfiled', title: 'Loose note', content: 'No folder.' })),
]);

addSheet('document_checklist_items', [
  ['id', 'document_id', 'sort_order', 'section', 'label'],
  ['item-3', 'doc-checklist', 20, 'Interior', 'Check the first aid kit'],
  ['item-1', 'doc-checklist', 10, 'Exterior', 'Check the tires'],
  ['item-2', 'doc-checklist', 10, 'Exterior', 'Check the lights'],
  ['item-x', 'doc-other', 0, '', 'Belongs to another document'],
  ['item-empty', 'doc-checklist', 30, '', ''],
]);

const firefighter = { id: 'user-ff', rank_id: 'rank-ff' };
const officer = { id: 'user-officer', rank_id: 'rank-officer' };
const RANKS = code.getSheetData(ss, 'ranks');

console.log('\n--- the rank rule ---');
check('no minimum reaches everyone', code.documentMeetsRank(RANKS, 'rank-ff', ''), true);
check('a higher rank passes', code.documentMeetsRank(RANKS, 'rank-officer', 'rank-ff'), true);
check('the same rank passes', code.documentMeetsRank(RANKS, 'rank-driver', 'rank-driver'), true);
check('a lower rank fails', code.documentMeetsRank(RANKS, 'rank-ff', 'rank-driver'), false);
check('a member with no rank fails closed', code.documentMeetsRank(RANKS, '', 'rank-ff'), false);
check('a minimum that no longer exists fails closed', code.documentMeetsRank(RANKS, 'rank-officer', 'rank-gone'), false);
check(
  'and an unreadable order fails closed',
  code.documentMeetsRank([{ id: 'rank-odd', rank_order: '' }], 'rank-odd', 'rank-odd'),
  false
);
check(
  'eligibility is about rank, NOT about being scheduled',
  code.documentMeetsRank(RANKS, 'rank-officer', 'rank-ff'),
  true
);

console.log('\n--- what a member is given ---');
const memberRows = code.memberDocumentRows(ss, firefighter, RANKS);
check(
  'a firefighter sees the unrestricted documents',
  memberRows.map((row) => row.id).sort(),
  ['doc-checklist', 'doc-open', 'doc-unfiled']
);
check('and not the one above their rank', memberRows.some((row) => row.id === 'doc-officer'), false);
check('nor any draft', memberRows.some((row) => row.id === 'doc-draft'), false);
check(
  'an officer sees the officer document',
  code.memberDocumentRows(ss, officer, RANKS).some((row) => row.id === 'doc-officer'),
  true
);

console.log('\n--- saving: fields, validation and the revision ---');
const fieldsFrom = (payload) => code.documentFieldsFrom(payload, {});
check('a new document is published unless told otherwise', fieldsFrom({ title: 'A' }).is_published, true);
check('and can be saved as a draft', fieldsFrom({ title: 'A', is_published: false }).is_published, false);
check('an unknown type reads as a document', fieldsFrom({ title: 'A', doc_type: 'leaflet' }).doc_type, 'markdown');
check('a checklist is kept', fieldsFrom({ title: 'A', doc_type: 'checklist' }).doc_type, 'checklist');
check('the title is trimmed', fieldsFrom({ title: '  Truck check  ' }).title, 'Truck check');
check('an over-long folder is capped rather than refused', fieldsFrom({ title: 'A', folder: 'x'.repeat(300) }).folder.length, 80);
checkIs('the body limit leaves room under the sheet cap', code.DOCUMENT_CONTENT_LIMIT < 50000);

check('a title is required', code.documentValidationError({ title: '', content: '', rank_id: '' }, RANKS), 'A title is required.');
checkIs(
  'an over-long body is refused, naming the limit',
  /45,000 characters/.test(code.documentValidationError({ title: 'A', content: 'x'.repeat(45001), rank_id: '' }, RANKS)),
  'the refusal should name the limit'
);
check(
  'a body exactly at the limit is accepted',
  code.documentValidationError({ title: 'A', content: 'x'.repeat(45000), rank_id: '' }, RANKS),
  ''
);
checkIs(
  'a minimum rank that no longer exists is refused',
  /no longer exists/.test(code.documentValidationError({ title: 'A', content: '', rank_id: 'rank-gone' }, RANKS)),
  'a deleted rank should be refused rather than silently stored'
);
check('a valid document saves', code.documentValidationError({ title: 'A', content: 'hi', rank_id: 'rank-ff' }, RANKS), '');

// The revision drives "signed before the latest edit", so it must count BODY edits only. A rename or a folder move
// bumping it would mark every signature stale for no reason, which is worse than not having the feature.
check('a new document starts at revision 1', code.documentRevisionFor({ content: 'hi' }, null), 1);
check(
  're-saving the same words does not bump it',
  code.documentRevisionFor({ content: 'hi' }, { content: 'hi', content_revision: 1 }),
  1
);
check(
  'editing the words does',
  code.documentRevisionFor({ content: 'hi there' }, { content: 'hi', content_revision: 1 }),
  2
);
check(
  'and a document whose revision predates the column still counts up',
  code.documentRevisionFor({ content: 'new' }, { content: 'old', content_revision: '' }),
  1
);

console.log('\n--- the sheets build themselves ---');
// Snapshot first: this section deletes and recreates the documents sheet, and the sections after it read the
// fixture, so it puts back what it found rather than leaving a wrecked workbook behind it.
const fixtureDocuments = sheets.documents.map((row) => row.slice());
delete sheets.documents;
const created = code.documentSheet(ss);
check('the sheet is created', Boolean(sheets.documents), true);
check('with the canonical header row', sheets.documents[0], code.DOCUMENT_HEADERS);
check('and a row is appended to it', (created.appendRow(['x']), sheets.documents.length), 2);

// A column added to the code later must appear on an existing sheet by itself, which is the promise the README
// makes for user_settings - and the thing that keeps a new feature from needing spreadsheet work.
delete sheets.documents;
addSheet('documents', [['id', 'title'], ['doc-1', 'Old']]);
code.ensureSheetHeaders(sheetStub('documents'), code.DOCUMENT_HEADERS);
check('an existing header row grows', sheets.documents[0].includes('is_sign_required'), true);
check('keeping the columns it already had', sheets.documents[0].slice(0, 2), ['id', 'title']);
const widthAfterFirst = sheets.documents[0].length;
code.ensureSheetHeaders(sheetStub('documents'), code.DOCUMENT_HEADERS);
check('and running it again adds nothing', sheets.documents[0].length, widthAfterFirst);

addSheet('documents', []);
code.ensureSheetHeaders(sheetStub('documents'), code.DOCUMENT_HEADERS);
check('an empty sheet starts from the canonical list', sheets.documents[0], code.DOCUMENT_HEADERS);

// Back to the fixture, for the sections that read it.
sheets.documents = fixtureDocuments.map((row) => row.slice());
check('the fixture is restored', code.getSheetData(ss, 'documents').length, 5);

console.log('\n--- signatures, before there are any ---');
check('no signatures sheet means no signatures', code.documentSignatureCount(ss, 'doc-open'), 0);
// The real header row, and rows that exercise every filter that matters: a member's own signature, a VERIFIER's
// acknowledgment of that same member, and a signature belonging to somebody else entirely.
addSheet('document_signatures', [
  ['id', 'document_id', 'checklist_item_id', 'user_id', 'signed_by_user_id', 'signature_role', 'signed_at', 'content_revision'],
  ['sig-1', 'doc-open', '', 'user-ff', 'user-ff', 'member', '2026-03-12 14:04:00', 1],
  ['sig-2', 'doc-officer', '', 'user-officer', 'user-officer', 'member', '2026-03-12 15:00:00', 2],
  ['sig-3', 'doc-open', '', 'user-ff', 'user-officer', 'verifier', '2026-03-13 09:00:00', 1],
  ['sig-4', 'doc-open', '', 'user-other', 'user-other', 'member', '2026-03-12 16:00:00', 1],
  ['sig-5', 'doc-checklist', 'item-1', 'user-ff', 'user-ff', 'member', '2026-03-13 10:00:00', 1],
]);
check('and they are counted per document', code.documentSignatureCount(ss, 'doc-officer'), 1);
check('a document nobody signed counts zero', code.documentSignatureCount(ss, 'doc-draft'), 0);

console.log('\n--- what a member may see of the signatures ---');
const firefighterSignatures = code.documentSignaturesForUser(ss, 'user-ff');
check(
  'a member gets their own rows, newest first',
  firefighterSignatures.map((signature) => signature.id),
  ['sig-5', 'sig-3', 'sig-1']
);
check(
  'including the verifier rows recorded about them',
  firefighterSignatures.some((signature) => signature.signature_role === 'verifier'),
  true
);
check(
  'and nobody else\u2019s',
  firefighterSignatures.some((signature) => signature.user_id !== 'user-ff'),
  false
);
check('an unknown member gets nothing', code.documentSignaturesForUser(ss, 'user-nobody').length, 0);
check('and a missing member id is not a wildcard', code.documentSignaturesForUser(ss, '').length, 0);

check(
  'the report for a document is every member\u2019s rows, newest first',
  code.documentSignaturesForDocument(ss, 'doc-open').map((signature) => signature.id),
  ['sig-3', 'sig-4', 'sig-1']
);

// The member's own signature: their own whole-document row, and NOT a verifier's row about them, and not an
// item-level row.
check('a member\u2019s own signature is found', code.documentSignatureFor(ss, 'doc-open', 'user-ff').id, 'sig-1');
check('a verifier row is not their own signature', code.documentSignatureFor(ss, 'doc-open', 'user-officer'), null);
check('nor is an item-level row', code.documentSignatureFor(ss, 'doc-checklist', 'user-ff'), null);
check('and a document they have not signed has none', code.documentSignatureFor(ss, 'doc-draft', 'user-ff'), null);

console.log('\n--- staleness ---');
check(
  'a signature from an earlier revision is stale',
  code.signatureIsStale({ content_revision: 1 }, { content_revision: 2 }),
  true
);
check(
  'one from the current revision is not',
  code.signatureIsStale({ content_revision: 2 }, { content_revision: 2 }),
  false
);
check(
  'a document edited before revisions existed is not flagged',
  code.signatureIsStale({ content_revision: 1 }, { content_revision: '' }),
  false
);
check(
  'and neither is a signature with no revision on it',
  code.signatureIsStale({ content_revision: '' }, { content_revision: 3 }),
  false
);
check(
  'an unknown role reads as a member',
  code.normalizeDocumentSignature({ id: 'x', document_id: 'd', signature_role: 'Chairman' }).signature_role,
  'member'
);

// The rule the whole design hangs on: getSheetData reads every cell whatever the projection, so the projection is
// the only thing standing between a document body and the wire.
checkIs(
  'the list carries no body at all',
  memberRows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'content')),
  'a list row carried content'
);
check('but does say how long it is', memberRows.find((row) => row.id === 'doc-open').content_length, 'Who is on duty.'.length);
check('and that it needs signing', memberRows.find((row) => row.id === 'doc-checklist').is_sign_required, true);

// Folders A-Z with the unfiled ones last, then the document's own order, then the title.
check(
  'folders are ordered, with Unfiled last',
  code
    .memberDocumentRows(ss, officer, RANKS)
    .map((row) => row.folder || '(blank)'),
  ['Apparatus', 'General', 'General', '(blank)']
);

console.log('\n--- the body, one document at a time ---');
const full = code.documentFullRow(ss, code.getSheetData(ss, 'documents').find((row) => row.id === 'doc-checklist'));
check('the single read carries the body', full.content, 'Complete before every shift.');
check(
  'the items come in order: sort_order, then the label',
  full.items.map((item) => item.label),
  ['Check the lights', 'Check the tires', 'Check the first aid kit']
);
check('items without a label are left out', full.items.some((item) => item.id === 'item-empty'), false);
check('and other documents\' items are left out', full.items.some((item) => item.id === 'item-x'), false);
check('a markdown document has no items', code.documentItemRows(ss, 'doc-open').length, 0);
check('and a missing items sheet is empty rather than an error', code.documentItemRows(ss, 'nope').length, 0);

// ---------------------------------------------------------------------------
// The actions: what is only legible as source
// ---------------------------------------------------------------------------
// Everything above proves the RULES. This proves the WIRING - that each action exists, is gated, and stamps what
// it should - which cannot be exercised without standing up doPost and everything it touches. The distinction
// matters when reading the output: a failure here is "somebody changed the gate", not "the rule is wrong".
console.log('\n--- the actions, read as source ---');
const action = (name) => {
  const start = codeSource.indexOf(`case "${name}": {`);
  if (start === -1) return '';
  return codeSource.slice(start, codeSource.indexOf('\n      case ', start + 10));
};

const readActions = ['GET_DOCUMENTS', 'GET_DOCUMENT', 'ADMIN_GET_DOCUMENTS', 'ADMIN_GET_DOCUMENT'];
readActions.forEach((name) => {
  const body = action(name);
  checkIs(`${name} exists`, body.length > 0);
  checkIs(`${name} needs a session`, /getAuthContext\(ss, data\)/.test(body), 'no session check');
});
readActions.slice(2).forEach((name) => {
  checkIs(
    `${name} needs can_manage_documents`,
    /hasRolePermission\([\s\S]{0,90}can_manage_documents/.test(action(name))
  );
});

const saveAction = action('ADMIN_SAVE_DOCUMENT');
checkIs(
  'a save validates before it writes',
  saveAction.indexOf('documentValidationError') < saveAction.indexOf('upsertSheetRowById')
);
checkIs('and stamps the author from the session', /author_user_id = docSaveAuth\.userId/.test(saveAction));
checkIs(
  'while an update cannot rewrite the author',
  /else delete documentFields\.author_user_id/.test(saveAction),
  'an edit could change who created a document'
);
checkIs(
  'the save grows the header row for what it carries',
  /ensureSheetHeaders\(documentTargetSheet, Object\.keys\(documentFields\)\)/.test(saveAction)
);

checkIs(
  'a delete refuses when the document has signatures',
  /documentSignatureCount[\s\S]{0,420}Unpublish it instead of deleting it/.test(action('ADMIN_DELETE_DOCUMENT')),
  'a signature could be orphaned by deleting what it was about'
);

const renameAction = action('ADMIN_RENAME_DOCUMENT_FOLDER');
checkIs('a folder rename is one bulk write', (renameAction.match(/setValues\(/g) || []).length === 1, 'more than one write');
checkIs(
  'and moves every document carrying the folder',
  /!== folderFrom\) continue/.test(renameAction) && /folderData\[folderRow\]\[folderColumn\] = folderTo/.test(renameAction),
  'the rename does not rewrite the rows it claims to'
);

readActions.forEach((name) => {
  checkIs(`${name} skips the script lock`, new RegExp(`\\n  ${name}: true,`).test(codeSource));
});
checkIs(
  'and the three sheets are registered for the id migration',
  ['"documents"', '"document_checklist_items"', '"document_signatures"'].every((name) => codeSource.includes(name))
);

console.log('\n--- the signature actions, read as source ---');
const signAction = action('SIGN_DOCUMENT');
checkIs('signing needs a session', /getAuthContext\(ss, data\)/.test(signAction));
checkIs(
  'and refuses a removal rather than ignoring one',
  /remove_signature_ids[\s\S]{0,300}cannot be withdrawn/.test(signAction),
  'a silent no-op would look like a working un-sign'
);
checkIs(
  'it takes BOTH identities from the session',
  /user_id: String\(signAuth\.userId\)/.test(signAction) && /signed_by_user_id: String\(signAuth\.userId\)/.test(signAction),
  'who signed whom must never come from the payload'
);
checkIs('the date is stamped by the server', /signed_at: getEasternTimestamp\(\)/.test(signAction));
checkIs(
  'and the revision is recorded from the document',
  /content_revision: parseInt\(signDocumentRow\.content_revision, 10\)/.test(signAction)
);
checkIs(
  'signing twice is not a second row',
  /existingSignature[\s\S]{0,420}already_signed: true/.test(signAction),
  'a repeated click must not add a signature'
);
checkIs(
  'a document that needs no signature is refused',
  /does not need a signature/.test(signAction)
);
checkIs(
  'and one the member may not see is reported as missing',
  /That document is not available/.test(signAction)
);

const removeSignatureAction = action('ADMIN_REMOVE_DOCUMENT_SIGNATURE');
checkIs(
  'removing a signature needs can_manage_documents',
  /hasRolePermission\([\s\S]{0,90}can_manage_documents/.test(removeSignatureAction)
);
checkIs('and it is logged', /logSystemEvent\([\s\S]{0,120}ADMIN_REMOVE_DOCUMENT_SIGNATURE/.test(removeSignatureAction));

const signatureReportAction = action('GET_DOCUMENT_SIGNATURES');
checkIs(
  'the report needs can_manage_documents OR can_verify_documents',
  /hasAnyRolePermission\([\s\S]{0,120}can_manage_documents[\s\S]{0,60}can_verify_documents/.test(
    signatureReportAction
  ),
  'a checklist verifier could not read what they are asked to verify'
);
checkIs(
  'and marks each signature stale against the document',
  /stale: signatureIsStale\(signature, signatureDocumentRow\)/.test(signatureReportAction)
);

checkIs('the signature report skips the script lock', /\n  GET_DOCUMENT_SIGNATURES: true,/.test(codeSource));
checkIs(
  'the member\u2019s list carries their own signatures',
  /documents: memberDocumentRows\(ss, docAuth\.user, getSheetData\(ss, "ranks"\)\),[\s\S]{0,220}signatures: documentSignaturesForUser\(ss, docAuth\.userId\)/.test(
    action('GET_DOCUMENTS')
  )
);
checkIs(
  'and the single read carries the member\u2019s own signature',
  /signature: documentSignatureFor\(ss, wantedDocument\.id, docOneAuth\.userId\)/.test(action('GET_DOCUMENT'))
);

console.log('\n--- the permission and the navigation ---');
const managePermission = ADMIN_PERMISSIONS.find((permission) => permission.key === 'can_manage_documents');
checkIs('the permission is declared', Boolean(managePermission));
check('pointing at the documents tab', managePermission && managePermission.tab, 'documents');
check('which is the tab id the nav uses', permissionTab('can_manage_documents'), 'documents');
check(
  'and it opens Administration for a role that has only it',
  allowedAdminTabs({ can_manage_documents: true })[0],
  'documents'
);
check('the admin bar can name it', ADMIN_BAR_LABELS.documents, 'Documents');
check('and so can the member bar', PAGE_BAR_LABELS.documents, 'Documents');

const panelSource = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
checkIs('Documents sits under Content', /\{ id: 'documents', label: 'Documents', icon: BookText \}/.test(panelSource));
checkIs('and renders only while its tab is open', /activeSubTab === 'documents' &&/.test(panelSource));

const sidebarSource = readFileSync('src/components/Sidebar.jsx', 'utf8');
checkIs('the member sidebar offers it', /setActiveTab\('documents'\)/.test(sidebarSource));
checkIs('to everyone, with no permission gate of its own', !/canViewDocuments|canManageDocuments/.test(sidebarSource));

const appSource = readFileSync('src/App.jsx', 'utf8');
checkIs('the app renders the module', /\{activeTab === 'documents' && \(/.test(appSource));
checkIs(
  'and gives it the bounded screen the Help pane uses',
  /const boundedScreen = activeTab === 'help' \|\| activeTab === 'documents'/.test(appSource)
);

// ---------------------------------------------------------------------------
// The client rules
// ---------------------------------------------------------------------------
console.log('\n--- the client rules ---');
const rows = normalizeDocumentList([
  { id: 'a', title: 'A', folder: 'General', doc_type: 'markdown', sort_order: 2 },
  { id: 'b', title: 'B', folder: '', doc_type: 'checklist', sort_order: 1 },
  { id: 'c', title: 'C', folder: 'General', sort_order: 1 },
  { title: 'No id', folder: 'General' },
  { id: 'd', title: 'D', folder: 'Apparatus', doc_type: 'nonsense' },
]);
check('a row without an id is not a document', rows.length, 4);
check('and an unknown type reads as a document', rows.find((row) => row.id === 'd').doc_type, 'markdown');
check('a checklist is recognized', isChecklist(rows.find((row) => row.id === 'b')), true);
check('unfiled documents are shown last', documentFolders(rows), ['Apparatus', 'General', UNFILED_LABEL]);
check(
  'and grouped with their folder',
  groupDocumentsByFolder(rows).map((group) => [group.folder, group.documents.map((row) => row.id)]),
  [
    ['Apparatus', ['d']],
    ['General', ['a', 'c']],
    [UNFILED_LABEL, ['b']],
  ]
);

// The folder column's two numbers. They have to agree with the second column, so they come from the same helpers -
// which is the point of them living here rather than in the component.
const folderRows = normalizeDocumentList([
  { id: 'g1', title: 'One', folder: 'General', is_sign_required: true },
  { id: 'g2', title: 'Two', folder: 'General' },
  { id: 'g3', title: 'Three', folder: 'General', is_sign_required: true },
  { id: 'u1', title: 'Loose', folder: '' },
]);
check(
  'a folder is summarized with how many documents it holds',
  folderSummaries(folderRows, [], 'user-ff').map((entry) => [entry.folder, entry.count]),
  [
    ['General', 3],
    [UNFILED_LABEL, 1],
  ]
);
check(
  'and how many are waiting on this member',
  folderSummaries(folderRows, [], 'user-ff').map((entry) => entry.outstanding),
  [2, 0]
);
check(
  'their own signature clears one',
  folderSummaries(
    folderRows,
    [{ id: 's1', document_id: 'g1', checklist_item_id: '', user_id: 'user-ff', signature_role: 'member' }],
    'user-ff'
  ).map((entry) => entry.outstanding),
  [1, 0]
);
check(
  'and somebody else\u2019s does not',
  folderSummaries(
    folderRows,
    [{ id: 's2', document_id: 'g1', checklist_item_id: '', user_id: 'user-other', signature_role: 'member' }],
    'user-ff'
  ).map((entry) => entry.outstanding),
  [2, 0]
);
check('a document that asks for no signature is never outstanding', folderSummaries([folderRows[1]], [], 'user-ff')[0].outstanding, 0);
check('and an empty library has no folders to show', folderSummaries([], [], 'user-ff'), []);
check(
  'searching covers the title and the folder',
  filterDocuments(rows, 'appar').map((row) => row.id),
  ['d']
);
check('and a blank query keeps everything', filterDocuments(rows, '   ').length, 4);
check('nothing matching says nothing', filterDocuments(rows, 'zzz').length, 0);

check('the form round-trips a document', documentToForm(rows[0]).id, 'a');
check('carrying the version for the concurrency check', documentToForm({ ...rows[0], row_version: 4 }).row_version, 4);
check('a title is required', documentSaveProblem({ title: '  ', content: '' }), 'A title is required.');
checkIs(
  'an over-long body is refused by the form too',
  /45,000 characters/.test(documentSaveProblem({ title: 'A', content: 'x'.repeat(DOCUMENT_CONTENT_LIMIT + 1) })),
  'the form should refuse before the request'
);
check('and a valid one passes', documentSaveProblem({ title: 'A', content: 'hi' }), '');
check('the counter counts down from the limit', documentCharactersLeft('abc'), DOCUMENT_CONTENT_LIMIT - 3);
check(
  'going over is reported rather than hidden',
  documentCharactersLeft('x'.repeat(DOCUMENT_CONTENT_LIMIT + 10)),
  -10
);
check('an undated document has no updated line', documentUpdatedLabel({}), '');

// ---------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------
console.log('\n--- the client\u2019s view of a signature ---');
const memberRow = {
  id: 'sig-1',
  document_id: 'a',
  checklist_item_id: '',
  user_id: 'user-ff',
  signed_by_user_id: 'user-ff',
  signature_role: 'member',
  signed_at: '2026-03-12 14:04:00',
  content_revision: 1,
};
const verifierRow = { ...memberRow, id: 'sig-2', signed_by_user_id: 'user-officer', signature_role: 'verifier' };
const otherRow = { ...memberRow, id: 'sig-3', user_id: 'user-other' };
const itemRow = { ...memberRow, id: 'sig-4', checklist_item_id: 'item-1' };

check('only their own member row counts as their signature', memberSignatureFor([memberRow], 'a', 'user-ff').id, 'sig-1');
check('a verifier row is not it', memberSignatureFor([verifierRow], 'a', 'user-ff'), null);
check('nor is an item row', memberSignatureFor([itemRow], 'a', 'user-ff'), null);
check('nor somebody else\u2019s', memberSignatureFor([otherRow], 'a', 'user-ff'), null);
check('signed ids ignore the other shapes', [...signedDocumentIds([memberRow, verifierRow, itemRow, otherRow], 'user-ff')], ['a']);

const signable = { id: 'a', is_sign_required: true };
const notSignable = { id: 'b', is_sign_required: false };
const unsigned = { id: 'c', is_sign_required: true };
check('a document needing a signature is outstanding', documentSignatureState(signable, [], 'user-ff'), 'outstanding');
check('and signed once they have', documentSignatureState(signable, [memberRow], 'user-ff'), 'signed');
check(
  'a document that needs none is its own state, not "outstanding"',
  documentSignatureState(notSignable, [], 'user-ff'),
  'not-required'
);
check(
  'the outstanding list is only the ones asking',
  outstandingSignatureDocuments([signable, notSignable, unsigned], [memberRow], 'user-ff').map((row) => row.id),
  ['c']
);
check('and the count is the number of those', outstandingSignatureDocuments([signable, unsigned], [], 'user-ff').length, 2);
checkIs(
  'a signed row is dated by the shared formatter',
  /^Signed \S/.test(signatureDateLabel(memberRow)),
  signatureDateLabel(memberRow)
);
check('and an undated one says nothing', signatureDateLabel({ ...memberRow, signed_at: '' }), '');
check('staleness travels from the server', signatureIsStale({ ...memberRow, stale: true }), true);
check('and defaults to false', signatureIsStale(memberRow), false);

console.log('\n--- checklist items, as records ---');
// The sheet's own header row and cells turned into the objects the screens receive - the same shape
// documentItemRows returns, built here so the checks below drive the real normalizer rather than a hand-made list.
const checklistSheet = sheets.document_checklist_items;
const checklistItems = checklistSheet.slice(1).map((row) =>
  Object.fromEntries(checklistSheet[0].map((header, index) => [header, row[index]]))
);
const itemFields = code.checklistItemFieldsFrom(
  { document_id: 'doc-checklist', label: '  Check the pump  ', section: '  Water  ', sort_order: '20' },
  {}
);
check('an item keeps its trim', [itemFields.label, itemFields.section], ['Check the pump', 'Water']);
check('and its order as a number', itemFields.sort_order, 20);
check(
  'an unreadable order becomes zero',
  code.checklistItemFieldsFrom({ document_id: 'd', label: 'L', sort_order: 'later' }, {}).sort_order,
  0
);
check(
  'and a runaway label is cut to the limit',
  code.checklistItemFieldsFrom({ document_id: 'd', label: 'x'.repeat(400) }, {}).label.length,
  300
);

const checklistDocument = code.getSheetData(ss, 'documents').find((row) => row.id === 'doc-checklist');
const markdownDocument = code.getSheetData(ss, 'documents').find((row) => row.id === 'doc-open');
check(
  'an item on a checklist is accepted',
  code.checklistItemValidationError({ label: 'Check the pump' }, checklistDocument),
  ''
);
check(
  'a blank label is refused',
  code.checklistItemValidationError({ label: '   ' }, checklistDocument),
  'An item needs a label.'
);
check(
  'and an item on a plain document is refused',
  code.checklistItemValidationError({ label: 'Check the pump' }, markdownDocument),
  'That document is not a checklist, so it has no items.'
);
check(
  'as is an item on a document that is gone',
  code.checklistItemValidationError({ label: 'Check the pump' }, null),
  'That document no longer exists.'
);

check('an item is found by id', code.checklistItemById(ss, 'item-1').label, 'Check the tires');
check('and an unknown one is null', code.checklistItemById(ss, 'item-nope'), null);

check(
  "the member's own signature on an item is found",
  code.checklistItemSignatures(ss, 'doc-checklist', 'item-1', 'user-ff', 'member').length,
  1
);
check(
  'and not mistaken for a verification',
  code.checklistItemSignatures(ss, 'doc-checklist', 'item-1', 'user-ff', 'verifier').length,
  0
);
check(
  'nor is another member\u2019s signature theirs',
  code.checklistItemSignatures(ss, 'doc-checklist', 'item-1', 'user-other', 'member').length,
  0
);
check('a signed item is known to be signed', code.checklistItemIsSigned(ss, 'item-1'), true);
check('and an unsigned one is not', code.checklistItemIsSigned(ss, 'item-2'), false);
check('a signature on another item does not mark this one', code.checklistItemIsSigned(ss, 'item-x'), false);

// Changing an item moves the DOCUMENT's revision, which is what makes the signatures taken before it report as
// stale. The rest of the row is left exactly as it was - an item edit is not an edit of the document's text.
const revisionBefore = Number(
  code.getSheetData(ss, 'documents').find((row) => row.id === 'doc-checklist').content_revision
);
const titleBefore = code.getSheetData(ss, 'documents').find((row) => row.id === 'doc-checklist').title;
check('an item change bumps the document revision', code.bumpDocumentRevision(ss, 'doc-checklist', null), true);
const revisionAfter = Number(
  code.getSheetData(ss, 'documents').find((row) => row.id === 'doc-checklist').content_revision
);
check('by exactly one', revisionAfter, revisionBefore + 1);
check(
  'and leaves the rest of the document alone',
  code.getSheetData(ss, 'documents').find((row) => row.id === 'doc-checklist').title,
  titleBefore
);
check('a document that is gone cannot be bumped', code.bumpDocumentRevision(ss, 'doc-nope', null), false);

console.log('\n--- one member\u2019s progress through a checklist ---');
// The fixture items for THIS document, in the order the screens show them: by sort_order, ties by label, which
// puts "Check the lights" before "Check the tires" and the unsectioned, unlabeled item last.
const screenItems = normalizeChecklistItemList(checklistItems).filter(
  (item) => item.document_id === 'doc-checklist'
);
check(
  'the items come back in screen order',
  screenItems.map((item) => item.id),
  ['item-2', 'item-1', 'item-3', 'item-empty']
);
check('an item belonging to another document is not here', screenItems.length, 4);

const memberItemSignatures = [
  {
    id: 'sig-5',
    document_id: 'doc-checklist',
    checklist_item_id: 'item-1',
    user_id: 'user-ff',
    signed_by_user_id: 'user-ff',
    signature_role: 'member',
    signed_at: '2026-03-13 10:00:00',
    content_revision: 1,
  },
];
check('a signed item says so', checklistItemState({ id: 'item-1' }, memberItemSignatures, 'user-ff').signed, true);
check('an unsigned one does not', checklistItemState({ id: 'item-2' }, memberItemSignatures, 'user-ff').signed, false);
check(
  'and a signature by somebody else is not theirs',
  checklistItemState({ id: 'item-1' }, memberItemSignatures, 'user-other').signed,
  false
);
check(
  'a verifier row marks it verified',
  checklistItemState(
    { id: 'item-1' },
    [
      ...memberItemSignatures,
      {
        id: 'sig-6',
        document_id: 'doc-checklist',
        checklist_item_id: 'item-1',
        user_id: 'user-ff',
        signed_by_user_id: 'user-officer',
        signature_role: 'verifier',
        signed_at: '2026-03-14 09:00:00',
        content_revision: 1,
      },
    ],
    'user-ff'
  ).verified,
  true
);
check(
  'and the verifier is named on it',
  checklistItemState(
    { id: 'item-1' },
    [
      ...memberItemSignatures,
      {
        id: 'sig-6',
        document_id: 'doc-checklist',
        checklist_item_id: 'item-1',
        user_id: 'user-ff',
        signed_by_user_id: 'user-officer',
        signature_role: 'verifier',
        signed_at: '2026-03-14 09:00:00',
        content_revision: 1,
      },
    ],
    'user-ff'
  ).verifiedByUserId,
  'user-officer'
);

const firefighterProgress = checklistProgress(screenItems, memberItemSignatures, 'user-ff');
check('the total is every item', firefighterProgress.total, 4);
check('one of them is signed', firefighterProgress.signed, 1);
check('none is verified yet', firefighterProgress.verified, 0);
check('three are still outstanding', firefighterProgress.outstanding, 3);
check('and one is waiting on a verifier', firefighterProgress.awaitingVerification, 1);
check(
  'which is what the label says',
  checklistProgressLabel(screenItems, memberItemSignatures, 'user-ff'),
  '1 of 4 items'
);
check('a checklist with no items has no label', checklistProgressLabel([], [], 'user-ff'), '');

const sections = checklistSections(screenItems);
check('items are grouped by section', sections.map((group) => group.section), ['Exterior', 'Interior', UNNAMED_SECTION]);
check('with both Exterior items in one group', sections[0].items.length, 2);
check(
  'and the unsectioned item last, not dropped',
  sections[sections.length - 1].items.map((item) => item.id),
  ['item-empty']
);

console.log('\n--- what a verifier still has to do ---');
const firefighterQueue = verificationQueue(screenItems, memberItemSignatures, 'user-ff');
check('the signed, unverified item is the queue', firefighterQueue.remainingIds, ['item-1']);
check('and only it', firefighterQueue.remaining.length, 1);

const awaiting = membersAwaitingVerification(screenItems, memberItemSignatures, 'user-officer');
check('an officer has one member to look at', awaiting.map((entry) => entry.userId), ['user-ff']);
check('with one item to confirm', awaiting[0].remaining.length, 1);
check(
  'and nothing at all on their own checklist',
  membersAwaitingVerification(screenItems, memberItemSignatures, 'user-ff').length,
  0
);
check('nor for somebody with no signatures', membersAwaitingVerification(screenItems, [], 'user-officer').length, 0);
check(
  'a signature on the DOCUMENT row is not a checklist item',
  membersAwaitingVerification(
    screenItems,
    [{ ...memberItemSignatures[0], checklist_item_id: '' }],
    'user-officer'
  ).length,
  0
);

const allSigned = screenItems.flatMap((item) => [
  { ...memberItemSignatures[0], id: `m-${item.id}`, checklist_item_id: item.id },
  { ...memberItemSignatures[0], id: `v-${item.id}`, checklist_item_id: item.id, signature_role: 'verifier' },
]);
check(
  'a fully signed and verified checklist is complete',
  checklistIsComplete(screenItems, allSigned, 'user-ff'),
  true
);
check(
  'but not when one item is unverified',
  checklistIsComplete(
    screenItems,
    allSigned.filter(
      (signature) => !(signature.signature_role === 'verifier' && signature.checklist_item_id === 'item-2')
    ),
    'user-ff'
  ),
  false
);
check('and an empty checklist is never complete', checklistIsComplete([], [], 'user-ff'), false);

console.log('\n--- the checklist actions (source) ---');
const itemWriteActions = ['ADMIN_SAVE_CHECKLIST_ITEM', 'ADMIN_DELETE_CHECKLIST_ITEM'];
itemWriteActions.forEach((name) => {
  const body = action(name);
  checkIs(`${name} exists`, body.length > 0);
  checkIs(`${name} needs a session`, /getAuthContext\(ss, data\)/.test(body), 'no session check');
  checkIs(
    `${name} is gated on can_manage_documents`,
    /hasRolePermission\(ss, \w+\.userId, "can_manage_documents"\)/.test(body),
    'no permission check'
  );
});
const saveItemAction = action('ADMIN_SAVE_CHECKLIST_ITEM');
checkIs(
  'saving an item refuses to move it to another document',
  /cannot be moved to another document/.test(saveItemAction),
  'an item could be re-pointed, taking its signatures with it'
);
checkIs(
  'and bumps the parent document, so earlier signatures read as stale',
  /bumpDocumentRevision\(ss, itemFields\.document_id, null\)/.test(saveItemAction),
  'item edits would not mark signatures stale'
);
const deleteItemAction = action('ADMIN_DELETE_CHECKLIST_ITEM');
checkIs(
  'deleting an item is refused once it is signed',
  /signature\.checklist_item_id === itemIdToDelete[\s\S]{0,400}cannot be removed/.test(deleteItemAction),
  'a signature could outlive the item it was about'
);

const signItemsAction = action('SIGN_CHECKLIST_ITEM');
checkIs('SIGN_CHECKLIST_ITEM exists', signItemsAction.length > 0);
checkIs('it needs a session', /getAuthContext\(ss, data\)/.test(signItemsAction), 'no session check');
checkIs(
  'it refuses a withdrawal outright',
  /remove_signature_ids[\s\S]{0,300}cannot be withdrawn/.test(signItemsAction),
  'a removal was not refused'
);
checkIs(
  'it takes a LIST of items, so ticking several is one request',
  /Array\.isArray\(many\)/.test(signItemsAction),
  'signing would be per item, which is 40 requests for a 40-item checklist'
);
checkIs(
  'both identities come from the session, never the payload',
  /user_id: String\(itemSignAuth\.userId\)[\s\S]{0,140}signed_by_user_id: String\(itemSignAuth\.userId\)/.test(
    signItemsAction
  ),
  'a signature could be attributed to somebody else'
);
checkIs(
  'and an unknown item is skipped rather than failing the batch',
  /itemSignSkipped \+= 1/.test(signItemsAction),
  'one bad id would abandon the good ones'
);

const verifyItemAction = action('VERIFY_CHECKLIST_ITEM');
checkIs('VERIFY_CHECKLIST_ITEM exists', verifyItemAction.length > 0);
checkIs(
  'it is gated on can_verify_documents',
  /hasRolePermission\(ss, \w+\.userId, "can_verify_documents"\)/.test(verifyItemAction),
  'verification would be open to anybody'
);
checkIs(
  'NOBODY verifies their own checklist',
  /verifyUserId === String\(verifyAuth\.userId\)[\s\S]{0,300}cannot verify your own checklist/.test(verifyItemAction),
  'self-verification is allowed'
);
checkIs(
  'verification follows the member\u2019s signature',
  /has not signed this item yet/.test(verifyItemAction),
  'an item nobody signed could be verified'
);
checkIs(
  'and the verifier is the session, not the payload',
  /signed_by_user_id: String\(verifyAuth\.userId\)/.test(verifyItemAction),
  'a verification could be attributed to somebody else'
);

const verifyRemainingAction = action('VERIFY_CHECKLIST_REMAINING');
checkIs('VERIFY_CHECKLIST_REMAINING exists', verifyRemainingAction.length > 0);
checkIs(
  'it is gated on can_verify_documents',
  /hasRolePermission\(ss, \w+\.userId, "can_verify_documents"\)/.test(verifyRemainingAction),
  'bulk verification would be open to anybody'
);
checkIs(
  'it refuses self-verification too',
  /bulkUserId === String\(bulkAuth\.userId\)[\s\S]{0,220}cannot verify your own checklist/.test(verifyRemainingAction),
  'self-verification is allowed in bulk'
);
checkIs(
  'it only verifies items the member actually signed',
  /signature_role === "member"[\s\S]{0,240}bulkItemIds\.indexOf/.test(verifyRemainingAction),
  'bulk verification could mark work nobody claimed'
);
checkIs(
  'and it stamps the whole batch with one timestamp',
  /bulkSignedAt = getEasternTimestamp\(\)[\s\S]{0,1200}signed_at: bulkSignedAt/.test(verifyRemainingAction),
  'the batch would look like separate decisions'
);

const signatureListAction = action('GET_DOCUMENT_SIGNATURES');
checkIs(
  'the signature report is open to verifiers as well as document managers',
  /hasAnyRolePermission\(ss, \w+\.userId, \["can_manage_documents", "can_verify_documents"\]\)/.test(
    signatureListAction
  ),
  'a verifier could not read what they are asked to verify'
);
checkIs(
  'and it carries the items, so a row can be named',
  /items: documentItemRows\(ss, signatureDocumentId\)/.test(signatureListAction),
  'signatures would arrive without item labels'
);

console.log('\n--- the screens render ---');
// Effects do not run on the server, so this is the loading state - which is also the state a member sees first.
const moduleHtml = renderToString(React.createElement(DocumentsModule, { token: 't1' }));
checkIs('the module says it is loading', /Loading the documents/.test(moduleHtml), 'no loading state');
checkIs('and names the module in its header', /Documents<\/h3>/.test(moduleHtml));

const tabHtml = renderToString(React.createElement(AdminDocumentsTab, { token: 't1' }));
checkIs('the tab renders', tabHtml.length > 200);
checkIs('with a way to start a document', /New document/.test(tabHtml), 'no New document button');
checkIs('and no dialog open on arrival', !/role="alertdialog"/.test(tabHtml));

const editorHtml = renderToString(React.createElement(MarkdownEditor, { value: '# Hello', onChange: () => {} }));
checkIs('the editor offers Write', />Write</.test(editorHtml));
checkIs('and Markdown', />Markdown</.test(editorHtml));
checkIs('and Preview', />Preview</.test(editorHtml));
checkIs('showing the count against the limit', /45,000/.test(editorHtml));
// Write is the rich surface: the document renders as formatted blocks, not as markdown source. Its HTML is put on
// the DOM after mount (never as raw HTML from the component), so the server-rendered page shows the empty surface -
// what can be asserted here is that the surface and the toolbar are there. verify-rich-markdown drives the engine
// that fills it.
checkIs('Write opens the rich surface', /role="textbox"/.test(editorHtml), 'the editor has no rich surface');
checkIs('which is multiline', /aria-multiline="true"/.test(editorHtml), 'the surface is not multiline');
checkIs('with a toolbar to format it', /aria-label="Bold"/.test(editorHtml), 'no toolbar');
checkIs('naming the editor', /aria-label="Content, rich text"/.test(editorHtml), 'the surface has no label');
checkIs('and the link form stays closed until it is needed', !/aria-label="Link address"/.test(editorHtml));

// The checklist screens, headlessly. Effects do not run on the server, so what these can assert is what a reader
// is offered before anything has loaded - which is where a verification panel offered to the wrong role would show
// up, since that is decided from a prop rather than a fetch.
const memberChecklistHtml = renderToString(
  React.createElement(DocumentsModule, { token: 't1', currentUser: { id: 'user-ff' }, canVerify: false })
);
checkIs(
  'a member with no verification permission is not offered one',
  !/Verification<\/p>/.test(memberChecklistHtml),
  'the verification panel rendered for somebody who cannot verify'
);
const verifierChecklistHtml = renderToString(
  React.createElement(DocumentsModule, { token: 't1', currentUser: { id: 'user-officer' }, canVerify: true })
);
checkIs(
  'and nothing claims the checklist is verified before it loads',
  !/Verified<\/span>/.test(verifierChecklistHtml),
  'a verified badge rendered with no data'
);

const itemEditorSource = readFileSync(
  path.resolve(process.cwd(), 'src/components/admin/AdminDocumentsTab.jsx'),
  'utf8'
);
checkIs(
  'the tab has an item editor for a checklist',
  /Edit document|Add item/.test(itemEditorSource) && /handleSaveItem/.test(itemEditorSource),
  'no way to add items'
);

// Items cannot be written before the document they belong to exists, which is exactly what made the feature look
// unimplemented: the panel used to appear only for a saved document, so a new checklist offered nowhere to type.
checkIs(
  'the item panel is offered for a checklist that has not been saved yet',
  /\{form\.doc_type === 'checklist' && \(/.test(itemEditorSource) &&
    !/\{isEditing && form\.doc_type === 'checklist'/.test(itemEditorSource),
  'the panel only appears once the document exists'
);
checkIs(
  'and it says the items are written when the document is created',
  /they are written as soon as it is created/.test(itemEditorSource),
  'staged items would look like saved ones'
);
checkIs(
  'a new item is staged rather than sent',
  /if \(!form\.id\) \{[\s\S]{0,400}setStagedItems/.test(itemEditorSource),
  'an item would be posted against a document that does not exist'
);
checkIs(
  'staged items are marked as not saved',
  /not saved<\/span>|not saved yet/.test(itemEditorSource),
  'nothing tells the author what is stored'
);
checkIs(
  'and each one is still written through the item action once it is created',
  /const flushStagedItems[\s\S]{0,900}adminSaveChecklistItem/.test(itemEditorSource),
  'staged items would never be written'
);
checkIs(
  'the flush happens only when a NEW checklist is created',
  /wasNew && wasChecklist && stagedItems\.length > 0/.test(itemEditorSource),
  'a save would re-post items'
);
checkIs(
  'and what landed is counted, not assumed',
  /flushed\.failed > 0[\s\S]{0,300}could not be saved/.test(itemEditorSource),
  'a partial write would be reported as a complete one'
);
checkIs(
  'removing a staged item needs no request',
  /startsWith\('staged-'\)[\s\S]{0,220}setPendingItemRemoval\(null\)/.test(itemEditorSource),
  'removing a staged item would try to delete it from the sheet'
);
checkIs(
  'removing an item asks first',
  /pendingItemRemoval[\s\S]{0,400}ConfirmModal/.test(itemEditorSource),
  'an item would be removed on one click'
);
checkIs(
  'and it keeps the editor in step with the document it just changed',
  /advanceRowVersion\(current\.row_version\)/.test(itemEditorSource),
  'the next document save would be refused as a concurrent edit'
);
const moduleSource = readFileSync(path.resolve(process.cwd(), 'src/components/DocumentsModule.jsx'), 'utf8');

console.log('\n--- the browser: folders, then documents, then the reader ---');
checkIs('there is a folder column', /Folders\s*</.test(moduleSource) && /FolderOption/.test(moduleSource), 'no folder column');
checkIs(
  'three columns on a wide screen, and the document column first below that',
  /lg:grid-cols-\[15rem_16rem_1fr\]/.test(moduleSource) && /md:grid-cols-\[18rem_1fr\]/.test(moduleSource),
  'the grid columns are not the shape the browser needs'
);
checkIs(
  'the folder choice becomes chips where the column is hidden',
  /lg:hidden/.test(moduleSource) && /role="tablist"/.test(moduleSource),
  'a narrow screen would have no way to choose a folder'
);
checkIs('a folder says how many documents it holds', /entry\.count/.test(moduleSource), 'no count on a folder');
checkIs(
  'and how many are waiting to be signed',
  /entry\.outstanding/.test(moduleSource),
  'the folder column would not show what needs signing'
);
checkIs(
  'choosing a folder lets go of the open document',
  /setFolder\(name\);[\s\S]{0,80}closeDocument\(\)/.test(moduleSource),
  'the reader would keep showing a document from another folder'
);
checkIs(
  'a filter spans every folder',
  /const filtering = query\.trim\(\) !== '' \|\| onlyOutstanding/.test(moduleSource),
  'a search would only cover the chosen folder'
);
checkIs(
  'and its rows name their folder',
  /filtering && \(/.test(moduleSource),
  'a row would not say which folder it came from'
);
checkIs(
  'a checklist is marked in the listing',
  /<ListChecks className="w-4 h-4 shrink-0" title="Checklist" \/>/.test(moduleSource),
  'a checklist looks like any other document in the list'
);

// The way back, which is the bug this browser was rebuilt for: reading a document replaces the list on a narrow
// screen, so without a control in the card's header the member has to leave the module and come back to it.
checkIs('there is a way back from a document', /aria-label="Back to the list"/.test(moduleSource), 'no back control');
checkIs(
  'and it sits in the card header, above the columns',
  moduleSource.indexOf('Back to the list') < moduleSource.indexOf('Folders'),
  'the back control is below the browser it returns to'
);
checkIs(
  'it is only offered while a document is open',
  /\{openId && \(/.test(moduleSource),
  'the back control is always on screen'
);
checkIs(
  'and reading a document hides the list below lg',
  /openId \? 'hidden lg:block'/.test(moduleSource),
  'a narrow screen would show the list above the document it is reading'
);
checkIs(
  'signing checklist items is collected and saved once',
  /signChecklistItems\(documentId, itemIds, token\)/.test(moduleSource),
  'the member screen would sign one item per request'
);
checkIs(
  'and the verification panel reads its own signatures',
  /fetchDocumentSignatures\(openDocumentId, token\)/.test(moduleSource),
  'the panel has no data of its own'
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

