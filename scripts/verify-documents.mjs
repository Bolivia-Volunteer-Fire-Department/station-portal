/**
 * Verifies the Documents feature: the client rules, the actions that expose them, and the two screens.
 *
 * What this exists for: a documents library is mostly quiet failure. A rank filter comparing the wrong direction
 * hides a document from the people who need it; a list that ships the body anyway looks fine on a small library
 * and turns an SOP shelf into a slow screen; a revision that increments on a rename makes every signature look
 * stale. None of those break the build, and none of them look wrong in a screenshot.
 *
 * The client rules are exercised directly; the source checks read the components that ship.
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
  DOCUMENT_TYPES,
  UNFILED_LABEL,
  documentCharactersLeft,
  documentFolders,
  documentIsLive,
  documentLifecycle,
  documentLinkProblem,
  documentLinkUrl,
  documentSaveProblem,
  documentSignatureState,
  documentToForm,
  documentUpdatedLabel,
  documentWindowLabel,
  filterDocuments,
  folderSummaries,
  groupDocumentsByFolder,
  isChecklist,
  isLink,
  memberSignatureFor,
  normalizeChecklistItemList,
  normalizeDocument,
  normalizeDocumentList,
  normalizeSignatureList,
  outstandingSignatureDocuments,
  reorderDocuments,
  reorderFolders,
  signatureDateLabel,
  signatureIsStale,
  signedDocumentIds,
} from '../src/utils/documents.js';
import { isActiveOnDate } from '../src/utils/effectiveDates.js';
import {
  UNNAMED_SECTION,
  checklistIsComplete,
  checklistItemState,
  checklistProgress,
  checklistProgressLabel,
  checklistSignatureEntries,
  checklistSections,
  checklistVerifiedLabel,
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

console.log('\n--- the permission and the navigation ---');
const managePermission = ADMIN_PERMISSIONS.find((permission) => permission.key === 'can_manage_documents');
checkIs('the permission is declared', Boolean(managePermission));
check('pointing at the documents tab', managePermission && managePermission.tab, 'documents');
check('which is the tab id the nav uses', permissionTab('can_manage_documents'), 'documents');
check(
  'and it opens Administration for a role that has only it',
  // The view permission is part of "only it": managing documents requires being able to see them, so a row with
  // can_manage_documents and nothing else is a row the Roles editor will not write and the server will not honour.
  allowedAdminTabs({ can_view_documents: true, can_manage_documents: true })[0],
  'documents'
);
check('the admin bar can name it', ADMIN_BAR_LABELS.documents, 'Documents');
check('and so can the member bar', PAGE_BAR_LABELS.documents, 'Documents');

const panelSource = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
checkIs('Documents sits under Content', /\{ id: 'documents', label: 'Documents', icon: BookText \}/.test(panelSource));
checkIs('and renders only while its tab is open', /activeSubTab === 'documents' &&/.test(panelSource));

const sidebarSource = readFileSync('src/components/Sidebar.jsx', 'utf8');
checkIs('the member sidebar offers it', /setActiveTab\('documents'\)/.test(sidebarSource));
checkIs(
  'gated on can_view_documents, the permission that means "may read documents at all"',
  /\{canViewDocuments && \([\s\S]{0,400}setActiveTab\('documents'\)/.test(sidebarSource),
  'a role with no documents permission would still see the module offered'
);

const appSource = readFileSync('src/App.jsx', 'utf8');
checkIs(
  'the app renders the module only with that permission',
  /\{activeTab === 'documents' && canViewDocuments && \(/.test(appSource)
);
checkIs(
  'and will not stay on the tab without it',
  /activeTab === 'documents'\n\s+\? canViewDocuments/.test(appSource),
  'the guard does not cover documents'
);
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

// ---------------------------------------------------------------------------
// A link document: `content` is an address, and only http(s) is followable.
// ---------------------------------------------------------------------------
console.log('\n--- link documents ---');
check('link is one of the three types', DOCUMENT_TYPES, ['markdown', 'checklist', 'link']);
check('a link is recognized', isLink({ id: 'l', doc_type: 'link', content: 'https://example.com' }), true);
check('and a document is not', isLink({ id: 'm', doc_type: 'markdown' }), false);
check('an https address is usable', documentLinkProblem('https://example.com/policy'), '');
check('so is http', documentLinkProblem('http://example.com'), '');
check('and it is handed over as given', documentLinkUrl({ doc_type: 'link', content: 'https://example.com' }), 'https://example.com');
check('a bare address is refused', documentLinkProblem('example.com'), 'A link must start with http:// or https://.');
check(
  'and the error says what to do',
  documentLinkProblem('example.com'),
  'A link must start with http:// or https://.'
);
// The one that matters: a script URL must never reach an href.
check('javascript: is refused', documentLinkProblem('javascript:alert(1)'), 'A link must start with http:// or https://.');
check('so is data:', documentLinkProblem('data:text/html,<script>'), 'A link must start with http:// or https://.');
check('and a scheme-less scheme-relative URL', documentLinkProblem('//example.com'), 'A link must start with http:// or https://.');
check('an address with a space in it is refused', documentLinkProblem('https://example.com/a b'), 'A link cannot contain spaces.');
check('an empty one is refused', documentLinkProblem(''), 'A link document needs an address.');
check('and a refused address is never handed over', documentLinkUrl({ doc_type: 'link', content: 'javascript:alert(1)' }), '');
check('nor is a non-link document', documentLinkUrl({ doc_type: 'markdown', content: 'https://example.com' }), '');
check(
  'the save refuses it before the request',
  documentSaveProblem({ title: 'T', doc_type: 'link', content: 'nope' }),
  'A link must start with http:// or https://.'
);
check(
  'and a link document is not length-checked as prose',
  documentSaveProblem({ title: 'T', doc_type: 'link', content: `https://example.com/${'a'.repeat(60000)}` }),
  ''
);

// ---------------------------------------------------------------------------
// Ordering by dragging
// ---------------------------------------------------------------------------
console.log('\n--- dragging to reorder ---');
const folderFixtures = normalizeDocumentList([
  { id: 'a1', title: 'A one', folder: 'Alpha', sort_order: 0 },
  { id: 'a2', title: 'A two', folder: 'Alpha', sort_order: 10 },
  { id: 'b1', title: 'B one', folder: 'Bravo', sort_order: 20 },
  { id: 'c1', title: 'C one', folder: 'Charlie', sort_order: 30 },
  { id: 'u1', title: 'Uno', folder: '', sort_order: 40 },
]);

check(
  'folders come out in the order their documents are in, not alphabetically',
  documentFolders(folderFixtures),
  ['Alpha', 'Bravo', 'Charlie', UNFILED_LABEL]
);
check(
  'and a dragged folder order is what the list shows',
  documentFolders([
    { id: 'x', title: 'X', folder: 'Zulu', sort_order: 0 },
    { id: 'y', title: 'Y', folder: 'Alpha', sort_order: 10 },
  ]),
  ['Zulu', 'Alpha']
);
check('Unfiled is pinned last whatever the numbers say', documentFolders([
  { id: 'x', title: 'X', folder: '', sort_order: 0 },
  { id: 'y', title: 'Y', folder: 'Alpha', sort_order: 10 },
]), ['Alpha', UNFILED_LABEL]);

// A folder drag rewrites the run of documents, because a folder is only a name on a document. The pairs are
// compared as a MAP with its keys in a fixed order - the order of the array or of the object's keys is irrelevant
// when every pair is written independently, and asserting either would pin down something nobody depends on.
const orderMap = (pairs) =>
  Object.fromEntries(
    pairs.map((entry) => [entry.id, entry.sort_order]).sort((a, b) => a[0].localeCompare(b[0]))
  );

const withinAlpha = normalizeDocumentList([
  { id: 'a1', title: 'A one', folder: 'Alpha', sort_order: 0 },
  { id: 'a2', title: 'A two', folder: 'Alpha', sort_order: 10 },
  { id: 'a3', title: 'A three', folder: 'Alpha', sort_order: 20 },
]);

check(
  'dragging a document down lands it after the target',
  orderMap(reorderDocuments(withinAlpha, 'a1', 'a2')),
  { a1: 10, a2: 0 }
);
check(
  'dragging a document up lands it before the target',
  orderMap(reorderDocuments(withinAlpha, 'a3', 'a1')),
  { a1: 10, a2: 20, a3: 0 }
);
check('a drop onto itself writes nothing', reorderDocuments(withinAlpha, 'a2', 'a2'), []);
check('an unknown id writes nothing', reorderDocuments(withinAlpha, 'nope', 'a1'), []);
check(
  'a drag never moves a document between folders',
  reorderDocuments(
    [
      { id: 'a1', title: 'A', folder: 'Alpha', sort_order: 0 },
      { id: 'b1', title: 'B', folder: 'Bravo', sort_order: 10 },
    ],
    'a1',
    'b1'
  ),
  []
);

const folderMove = reorderFolders(folderFixtures, 'Charlie', 'Alpha');
check(
  'dragging a folder up in front of another moves the whole block',
  orderMap(folderMove),
  { a1: 10, a2: 20, b1: 30, c1: 0 }
);
check(
  'and dragging one down moves it after',
  orderMap(reorderFolders(folderFixtures, 'Alpha', 'Bravo')),
  { a1: 10, a2: 20, b1: 0 }
);
check('Unfiled is never dragged', reorderFolders(folderFixtures, UNFILED_LABEL, 'Alpha'), []);
check('nor is anything dragged after it', reorderFolders(folderFixtures, 'Alpha', UNFILED_LABEL), []);
check('a folder dropped on itself writes nothing', reorderFolders(folderFixtures, 'Alpha', 'Alpha'), []);

// The drop is a WRITE, and the list is frozen until it lands - dragging is off and nothing on screen has moved
// yet. Without a word on screen that reads as a drop that did nothing, followed by an abrupt jump when the new
// order arrives. These are source assertions because the saving state cannot be reached in a render: it begins
// with a drag.
const dragSurface = readFileSync('src/components/admin/AdminDocumentsTab.jsx', 'utf8');
check('the drag surface reports that it is busy', /aria-busy=\{savingOrder\}/.test(dragSurface), true);
check('and says what is happening, where the instruction was', /Saving the new order…/.test(dragSurface), true);
check(
  'with a spinner rather than a still frame',
  /savingOrder \? \(/.test(dragSurface) && /Loader2 className="w-3\.5 h-3\.5 animate-spin"/.test(dragSurface),
  true
);
// Which is what makes the message honest: nothing can be picked up again until the write lands.
check('and dragging is off until it lands', /draggable=\{!savingOrder\}/.test(dragSurface), true);
check(
  'so a second drag cannot be started mid-save',
  /const startDocumentDrag = \(event, row\) => \{\s*if \(savingOrder\)/.test(dragSurface),
  true
);
check('and a folder with no documents is not a folder', reorderFolders(folderFixtures, 'Ghost', 'Alpha'), []);

console.log('\n--- effective and end dates ---');
const windowed = normalizeDocument({
  id: 'w',
  title: 'W',
  doc_type: 'markdown',
  effective_date: '2026-07-01',
  end_date: '2026-12-31',
});
check('the dates are read onto the document', [windowed.effective_date, windowed.end_date], ['2026-07-01', '2026-12-31']);
check('a blank pair means no restriction', documentLifecycle({ ...windowed, effective_date: '', end_date: '' }, '2026-07-01'), 'active');
check('a blank pair is not "retired"', isActiveOnDate({ effective_date: '', end_date: '' }, '2026-07-01'), true);
check('before the effective date it is scheduled', documentLifecycle(windowed, '2026-06-01'), 'scheduled');
check('between the two it is active', documentLifecycle(windowed, '2026-07-15'), 'active');
check('after the end date it is retired', documentLifecycle(windowed, '2027-01-01'), 'retired');
check('the effective date itself is inside the window', documentLifecycle(windowed, '2026-07-01'), 'active');
check('and so is the end date', documentLifecycle(windowed, '2026-12-31'), 'active');
check('the window is labeled for a badge', documentWindowLabel(windowed), 'Jul 1, 2026 - Dec 31, 2026');
check('an end date alone reads as "Until"', documentWindowLabel({ end_date: '2026-06-30' }), 'Until Jun 30, 2026');
check('an effective date alone reads as "From"', documentWindowLabel({ effective_date: '2026-07-01' }), 'From Jul 1, 2026');
check('no dates means no label', documentWindowLabel({}), '');
check('a backwards window is refused', documentSaveProblem({ title: 'T', content: '', effective_date: '2026-07-01', end_date: '2026-06-30' }), 'The end date must not be before the effective date.');
check('a save with no dates is fine', documentSaveProblem({ title: 'T', content: '', effective_date: '', end_date: '' }), '');
check('and so is one with only an end date', documentSaveProblem({ title: 'T', content: '', end_date: '2026-06-30' }), '');
check('documentIsLive agrees with the lifecycle', documentIsLive(windowed, '2027-01-01'), false);
check('the window survives the round trip to the form', documentToForm(windowed).end_date, '2026-12-31');
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

// A checklist is signed item by item, so its state is read from its ITEMS rather than from a document signature -
// which is what keeps it off the "to sign" list once the member has ticked everything, and on it while they have
// not. The item counts come from the server, because the list carries no items.
const checklistPartial = { id: 'cl', doc_type: 'checklist', is_sign_required: true, item_count: 4, items_signed: 1 };
const checklistDone = { id: 'cl', doc_type: 'checklist', is_sign_required: true, item_count: 4, items_signed: 4 };
const checklistEmpty = { id: 'cl', doc_type: 'checklist', is_sign_required: true, item_count: 0, items_signed: 0 };
check('a partly ticked checklist is outstanding', documentSignatureState(checklistPartial, [], 'user-ff'), 'outstanding');
check('a fully ticked one is not', documentSignatureState(checklistDone, [], 'user-ff'), 'signed');
check(
  'and a checklist with no items asks nothing of anybody',
  documentSignatureState(checklistEmpty, [], 'user-ff'),
  'not-required'
);
check(
  'and it decides by the ITEMS even when a row predating the rule still has the flag off',
  documentSignatureState(
    { id: 'cl', doc_type: 'checklist', is_sign_required: false, item_count: 2, items_signed: 0 },
    [],
    'user-ff'
  ),
  'outstanding'
);
check(
  'the outstanding list counts a checklist by its items',
  outstandingSignatureDocuments([checklistPartial, checklistDone], [], 'user-ff').map((row) => row.id),
  ['cl']
);
check(
  'and the folder badge follows the same rule',
  folderSummaries([checklistPartial, checklistDone], [], 'user-ff')[0].outstanding,
  1
);
checkIs(
  'a signed row is dated by the shared formatter',
  /^Signed \S/.test(signatureDateLabel(memberRow)),
  signatureDateLabel(memberRow)
);
check('and an undated one says nothing', signatureDateLabel({ ...memberRow, signed_at: '' }), '');
check('staleness travels from the server', signatureIsStale({ ...memberRow, stale: true }), true);
check('and defaults to false', signatureIsStale(memberRow), false);

// The fixture items for the screen-order check below: the same rows the sign-in payload's
// item list carries, in no particular order.
const checklistItems = [
  { id: 'item-3', document_id: 'doc-checklist', sort_order: 20, section: 'Interior', label: 'Check the first aid kit' },
  { id: 'item-1', document_id: 'doc-checklist', sort_order: 10, section: 'Exterior', label: 'Check the tires' },
  { id: 'item-2', document_id: 'doc-checklist', sort_order: 10, section: 'Exterior', label: 'Check the lights' },
  { id: 'item-x', document_id: 'doc-other', sort_order: 0, section: '', label: 'Belongs to another document' },
  { id: 'item-empty', document_id: 'doc-checklist', sort_order: 30, section: '', label: '' },
];

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

// ---------------------------------------------------------------------------
// One row per member per item on the administrator's signatures card.
//
// The reported bug: a checklist listed every signed item TWICE - once for the member's signature, once for the
// verification, which is a separate row in the same sheet - so "Verified by…" appeared interleaved as though the
// item had been done again, and the count in the heading was the number of records rather than of signatures.
// The card is built from these entries now, so this is the shape that has to be right.
console.log('\n--- one row per member per item ---');
const foldItems = [
  { id: 'f1', document_id: 'doc-checklist', label: 'Check the pump', sort_order: 1 },
  { id: 'f2', document_id: 'doc-checklist', label: 'Check the hose', sort_order: 2 },
];
const foldSignatures = [
  { id: 'x1', document_id: 'doc-checklist', checklist_item_id: 'f1', user_id: 'u-ff', signed_by_user_id: 'u-ff', signature_role: 'member', signed_at: '2026-04-01 09:00:00' },
  { id: 'x2', document_id: 'doc-checklist', checklist_item_id: 'f1', user_id: 'u-ff', signed_by_user_id: 'u-officer', signature_role: 'verifier', signed_at: '2026-04-02 09:00:00' },
  { id: 'x3', document_id: 'doc-checklist', checklist_item_id: 'f2', user_id: 'u-ff', signed_by_user_id: 'u-ff', signature_role: 'member', signed_at: '2026-04-01 09:05:00' },
  { id: 'x4', document_id: 'doc-checklist', checklist_item_id: 'f1', user_id: 'u-other', signed_by_user_id: 'u-other', signature_role: 'member', signed_at: '2026-04-01 09:10:00' },
];
const folded = checklistSignatureEntries(foldItems, foldSignatures);
check('four records fold into three rows', folded.length, 3);
check('which is fewer than the records the heading used to count', foldSignatures.length - folded.length, 1);
check(
  'each row is one member and one item',
  folded.map((entry) => `${entry.userId}|${entry.itemId}`),
  ['u-ff|f1', 'u-other|f1', 'u-ff|f2']
);
check(
  'the verification is attached to the signature it confirms',
  folded[0].verifications.map((verification) => verification.byUserId),
  ['u-officer']
);
check('and is not a row of its own', folded.filter((entry) => entry.verifications.length > 0).length, 1);
check('the member row keeps its id, so it can still be removed', [folded[0].signatureId, folded[1].signatureId], ['x1', 'x4']);
check('the verification keeps its id too', folded[0].verifications[0].id, 'x2');
check('an unverified row has no verifications', folded[2].verifications, []);
check('the item label travels with the row', folded.map((entry) => entry.itemLabel), ['Check the pump', 'Check the pump', 'Check the hose']);
check('and when it was signed', folded[0].signedAt, '2026-04-01 09:00:00');

// Two officers may both confirm one item - the server allows it deliberately - and that must still be ONE row,
// with both named, rather than pushing the count back up.
const twiceVerified = checklistSignatureEntries(foldItems, [
  ...foldSignatures,
  { id: 'x5', document_id: 'doc-checklist', checklist_item_id: 'f1', user_id: 'u-ff', signed_by_user_id: 'u-chief', signature_role: 'verifier', signed_at: '2026-04-03 09:00:00' },
]);
check('two verifications are still one row', twiceVerified.length, 3);
check('naming both verifiers', twiceVerified[0].verifications.map((verification) => verification.byUserId), ['u-officer', 'u-chief']);

// A signature taken before the checklist had items belongs to the whole document. It is kept rather than folded
// away or hidden: this card is a record, and a record that drops rows is worse than one that looks untidy.
const legacyFold = checklistSignatureEntries(foldItems, [
  ...foldSignatures,
  { id: 'x6', document_id: 'doc-checklist', checklist_item_id: '', user_id: 'u-ff', signed_by_user_id: 'u-ff', signature_role: 'member', signed_at: '2026-01-01 09:00:00' },
]);
check('a whole-document signature keeps a row of its own', legacyFold.length, 4);
check('labelled as the document rather than as an item', legacyFold[3].itemLabel, '');

// An item since removed, and no items to order by at all: the rows still read as sentences, and the loose item
// sorts by when it was signed rather than vanishing.
const orphanFold = checklistSignatureEntries([], foldSignatures);
check('an item the checklist no longer holds is still named', orphanFold[0].itemLabel, 'an item since removed');
check(
  'and with no items to order by, the rows fall back to when they were signed',
  orphanFold.map((entry) => entry.itemId),
  ['f1', 'f2', 'f1']
);

// ---------------------------------------------------------------------------
// The card: the rows it draws, and the pager under them.
console.log('\n--- the signatures card in the tab ---');
const documentsTab = readFileSync('src/components/admin/AdminDocumentsTab.jsx', 'utf8');
check('a checklist card is built from the folded rows', /form\.doc_type === 'checklist'[\s\S]{0,160}checklistSignatureEntries\(items, signatures\)/.test(documentsTab), true);
check('and every other document still lists one row per signature', /return signatures\.map\(\(signature\) => \(\{/.test(documentsTab), true);
check('the heading counts the rows, not the records', /\{signatureRows\.length\} \{signatureCountNoun\}/.test(documentsTab), true);
check('and calls a checklist row what it is', /signatureCountNoun = form\.doc_type === 'checklist' \? 'signed item' : 'signature'/.test(documentsTab), true);
// The membership test that pages it, and the clamp that stops a delete emptying the card.
check('the card is paged with the shared helpers', /pageSlice\(signatureRows, currentSignaturePage, SIGNATURE_PAGE_SIZE\)/.test(documentsTab), true);
check('and clamped, so the last page cannot go empty', /clampPage\(signaturePage, signatureRows\.length, SIGNATURE_PAGE_SIZE\)/.test(documentsTab), true);
check('the pager hides itself on a single page', /signaturePageCount > 1 && \(/.test(documentsTab), true);
check('and says which rows are showing', /pageRangeLabel\(signatureRows\.length, currentSignaturePage, SIGNATURE_PAGE_SIZE\)/.test(documentsTab), true);
// Both records on a row are removable, and each says which it is: they are separate rows in the sheet, so
// removing one must not look like removing the other.
check('a signature can still be removed from a folded row', /remove signature/.test(documentsTab), true);
// Each verification gets its own control, told apart from the signature's by its wording. (It used to name the
// verifier here; the label is the tab's own business, so this asserts what the pair has to be - two different
// controls - rather than its exact text.)
check('and so can each verification', /remove verification/.test(documentsTab), true);
check('the confirmation names which one goes', /pendingSignatureRemoval\.role === 'verifier'/.test(documentsTab), true);
// Reloading the signatures sends the reader back to the first page: a reload is a different list.
check('a reload returns to the first page', /setSignaturePage\(1\);/.test(documentsTab), true);

// ---------------------------------------------------------------------------
// The editor is a modal: opened on demand, most of the viewport, with a toolbar that saves and cancels.
console.log('\n--- the editor modal ---');
const viewportModal = readFileSync('src/components/ViewportModal.jsx', 'utf8');
check('the toolbar button opens it', /onClick=\{\(\) => openDocument\(''\)\}/.test(documentsTab), true);
check('and choosing a document opens it too', /onClick=\{\(\) => openDocument\(row\.id\)\}/.test(documentsTab), true);
check('it opens before the fetch, so the wait is the modal\'s own', /setEditorOpen\(true\)[\s\S]{0,200}adminFetchDocument/.test(documentsTab), true);
check('it is mounted only while it is open', /\{editorOpen && \(/.test(documentsTab), true);
check('with a Save that knows its label', /saveLabel=\{isEditing \? 'Save changes' : 'Create document'\}/.test(documentsTab), true);
check('and the form it belongs to', /formId=\{EDITOR_FORM_ID\}/.test(documentsTab), true);

// The write is what closes it, and a failed write must leave it open with the error in it.
check(
  'it closes once the write is confirmed',
  /const result = await adminSaveDocument\(form, token\);[\s\S]{0,900}setEditorOpen\(false\);/.test(documentsTab),
  true
);
check(
  'and stays open when the save fails',
  /catch \(err\) \{\s*setError\(err\?\.message \|\| 'Could not save the document\.'\);/.test(documentsTab),
  true
);

// Busy: the form is disabled, the toolbar says what it is waiting for, and the modal cannot be left mid-write.
check('the body is disabled while it is busy', /<fieldset disabled=\{busy\}/.test(viewportModal), true);
check('the toolbar swaps its icon for a spinner', /saving \? <Loader2 className="h-4 w-4 animate-spin" \/>/.test(viewportModal), true);
check('and says what it is waiting for', /busyLabel/.test(viewportModal) && /Opening the document…/.test(documentsTab), true);
check('Escape is ignored while a write is in flight', /if \(busy\) return;/.test(viewportModal), true);
check('and so is the backdrop', /if \(!busy\) dismiss\(\);/.test(viewportModal), true);

// The shell: full screen on a phone, most of the viewport once there is room, toolbar pinned above a body that
// scrolls - which is what makes Save reachable from the bottom of a long checklist.
// Full screen on a phone, at every size: only the `sm:` frame varies (asserted below).
check('the panel is full screen on a phone', /relative flex h-full w-full flex-col/.test(viewportModal), true);
check('and most of the viewport on a larger screen', /sm:w-\[94vw\] sm:max-w-6xl/.test(viewportModal), true);
// The toolbar is what stays put while the body scrolls, so the two are asserted as two facts: the toolbar does not
// shrink, the body is the flexible scrolling child, and the toolbar comes first.
check('the toolbar does not shrink', /flex shrink-0 flex-wrap/.test(viewportModal), true);
check(
  'the body is the part that scrolls',
  /min-h-0 flex-1 overflow-y-auto overscroll-contain/.test(viewportModal),
  true
);
check(
  'and the toolbar is above it',
  viewportModal.indexOf('flex shrink-0 flex-wrap') < viewportModal.indexOf('min-h-0 flex-1 overflow-y-auto'),
  true
);
check('with the phone safe areas respected', /env\(safe-area-inset-top\)/.test(viewportModal), true);
// The Save button lives outside the <form>, so it submits through the HTML form attribute - or, when the body is
// not a form at all (the certification editors), calls onSave instead.
check('Save submits the form from the toolbar', /type=\{formId \? 'submit' : 'button'\}[\s\S]{0,220}form=\{formId\}/.test(viewportModal), true);
check('and a body with no form saves through a handler', /onClick=\{formId \? undefined : onSave\}/.test(viewportModal), true);
// A modal is a tone per open, from the one table.
check('and it announces itself like every other modal', /modalSoundFor\('documentEditor'\)/.test(viewportModal), true);

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

console.log('\n--- the screens render ---');
// Effects do not run on the server, so this is the loading state - which is also the state a member sees first.
const moduleHtml = renderToString(React.createElement(DocumentsModule, { token: 't1' }));
checkIs('the module says it is loading', /Loading the documents/.test(moduleHtml), 'no loading state');
checkIs('and names the module in its header', /Documents<\/h3>/.test(moduleHtml));

const tabHtml = renderToString(React.createElement(AdminDocumentsTab, { token: 't1', canManageDocuments: true }));
checkIs('the tab renders', tabHtml.length > 200);
checkIs('with a way to start a document', /New document/.test(tabHtml), 'no New document button');
checkIs('and no dialog open on arrival', !/role="alertdialog"/.test(tabHtml));
// The window is on the editor, and it is optional: an empty effective date means "already live", which is how
// every document written before these columns behaved.
// The editor is a MODAL now - opened from the toolbar or by choosing a row - so it is not in the page's HTML at
// all until then, which is the whole point of the change. Its contents are therefore asserted at the source, the
// way this file already treats what only exists while a dialog is open.
checkIs('the editor is not on the page until it is opened', !/id="document-editor-form"/.test(tabHtml), 'the form is rendered with the page again');
checkIs('the editor can set an effective date', /id="document-effective-date"/.test(documentsTab));
checkIs('and an end date', /id="document-end-date"/.test(documentsTab));
checkIs('and says what an end date does to signatures', /Signatures already on it are kept/.test(documentsTab));
// Three document types now, and the third one is a link. The options are built from DOCUMENT_TYPES (imported
// above), so this asserts the label the tab gives it rather than the label existing somewhere.
checkIs('the type list offers a Link', /type === 'link' \? 'Link'/.test(documentsTab));

// A role that may VERIFY but not MANAGE gets the verification view on its own - no editor, and no list to click
// through to one.
const verifierTabHtml = renderToString(
  React.createElement(AdminDocumentsTab, { token: 't1', canVerifyDocuments: true })
);
checkIs('a verifier gets the verification view', /Verify checklists/.test(verifierTabHtml));
checkIs('and never the editor', !/New document/.test(verifierTabHtml), 'a verifier was offered the editor');
checkIs(
  'and is told why when the role can do neither',
  /do not have permission to manage or verify documents/.test(
    renderToString(React.createElement(AdminDocumentsTab, { token: 't1' }))
  )
);

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
  'two columns on a wide screen: the folders, then the list, and no third track waiting',
  /lg:grid-cols-\[16rem_1fr\]/.test(moduleSource) && /md:grid-cols-\[18rem_1fr\]/.test(moduleSource),
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
  'and reading a document takes the whole card',
  /openId\s*\n\s*\? 'md:flex-1 md:min-h-0 md:flex'/.test(moduleSource),
  'the reader would share the card with the list it came from'
);
checkIs(
  'so the folder column and the list are put away, not merely narrowed',
  (moduleSource.match(/\{!openId && \(/g) || []).length >= 2,
  'a column would still be rendered beside the reader'
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

// Ticking an item: the row itself is the control. The report was "clicking checklist items does nothing", and a
// 16px button that only its own square responds to is exactly that - so the button is the whole row and the box is
// drawn inside it.
console.log('\n--- ticking an item ---');
checkIs(
  'the whole row is the control, not just the box',
  /const tickable = Boolean\(onToggle\) && canTick && !state\.signed;/.test(moduleSource) &&
    /if \(tickable\) \{[\s\S]{0,120}<button/.test(moduleSource),
  'only the 16px box would respond, which reads as broken'
);
checkIs(
  'and the box inside it is a span, not a nested button',
  !/<button[\s\S]{0,600}?<span[\s\S]{0,200}<button/.test(moduleSource),
  'a button inside a button is invalid and swallows the click'
);
checkIs(
  'the label says which item it ticks',
  /aria-label=\{ticked \? `Untick \$\{item\.label\}` : `Tick \$\{item\.label\}`\}/.test(moduleSource),
  'a screen reader would hear only "button"'
);
checkIs(
  'an already-signed item is not offered as a button',
  /onToggle && state\.signed[\s\S]{0,80}Signatures cannot be removed/.test(moduleSource),
  'a signed item would be tickable, then refused'
);
checkIs(
  'a checklist is always signed item by item, so its items are always tickable',
  /const itemsAreSignable = documentIsChecklist;/.test(moduleSource) &&
    /canTick=\{canTickItems\}/.test(moduleSource),
  'a checklist whose stored flag is false would show items that refuse to be ticked'
);
checkIs(
  'and the document-level sign block is not offered on a checklist',
  /\{openDocument\.is_sign_required && !documentIsChecklist && \(/.test(moduleSource),
  'a checklist would offer to be signed as a whole, which the server refuses'
);

// A link document: there is no body to render, so the reader offers the address instead.
console.log('\n--- a link document in the reader ---');
checkIs(
  'a link document opens in a new tab',
  /target="_blank"/.test(moduleSource) && /rel="noreferrer"/.test(moduleSource),
  'an external page could reach back into this tab'
);
checkIs('and the address is shown as well as linked', /\{openLinkUrl\}/.test(moduleSource));
checkIs(
  'an unusable address is reported, not offered',
  /This link has no usable address/.test(moduleSource),
  'a dead or dangerous link would still be clickable'
);
checkIs(
  'and a link is marked in the listing',
  /isLink\(item\) \? \([\s\S]{0,120}title="Opens an external link"/.test(moduleSource)
);
// The member module does not filter by dates itself: the server decides which documents are live and never sends a
// retired one. What the client does with the window is LABEL it, for the administrator who can see both.
const tabSource = readFileSync(
  path.resolve(process.cwd(), 'src/components/admin/AdminDocumentsTab.jsx'),
  'utf8'
);
checkIs(
  'and the admin list marks a retired document',
  /documentLifecycle\(row, todayKeyValue\) === 'retired'/.test(tabSource) &&
    /documentLifecycle\(row, todayKeyValue\) === 'scheduled'/.test(tabSource),
  'a retired document would be indistinguishable from a live one'
);

// Verifying from the Administration module: pick the checklist, then the member, then confirm each item.
console.log('\n--- saying who verified an item ---');
const verifiedState = {
  verified: true,
  verifiedAt: '2026-07-01 14:04:00',
  verifiedByUserId: 'user-officer',
  verificationCount: 1,
};
check(
  'the row names the verifier and the date',
  checklistVerifiedLabel(verifiedState, 'Jane Doe'),
  'Verified by Jane Doe on Wed, Jul 1 2026 · 2:04 PM'
);
check(
  'a 24-hour clock is the caller\u2019s choice',
  checklistVerifiedLabel(verifiedState, 'Jane Doe', '24'),
  'Verified by Jane Doe on Wed, Jul 1 2026 · 14:04'
);
check('no name means no name in the sentence', checklistVerifiedLabel({ ...verifiedState }, ''), 'Verified on Wed, Jul 1 2026 · 2:04 PM');
check('no date leaves just the name', checklistVerifiedLabel({ ...verifiedState, verifiedAt: '' }, 'Jane Doe'), 'Verified by Jane Doe');
check('neither leaves just the word', checklistVerifiedLabel({ verified: true, verifiedAt: '', verifiedByUserId: '' }, ''), 'Verified');
check(
  'two verifiers are counted rather than picked between',
  checklistVerifiedLabel({ ...verifiedState, verificationCount: 2 }, 'Jane Doe'),
  'Verified by 2 people on Wed, Jul 1 2026 · 2:04 PM'
);
check(
  'the queue exposes the verified states the record list is built from',
  verificationQueue(
    [{ id: 'i1', label: 'One' }, { id: 'i2', label: 'Two' }],
    [
      { ...memberRow, checklist_item_id: 'i1' },
      { ...memberRow, checklist_item_id: 'i2' },
      { ...verifierRow, checklist_item_id: 'i1' },
    ],
    'user-ff'
  ).verifiedItems.map((state) => state.item.label),
  ['One']
);
check(
  'and the count matches the list it is shown beside',
  verificationQueue(
    [{ id: 'i1', label: 'One' }, { id: 'i2', label: 'Two' }],
    [
      { ...memberRow, checklist_item_id: 'i1' },
      { ...memberRow, checklist_item_id: 'i2' },
      { ...verifierRow, checklist_item_id: 'i1' },
    ],
    'user-ff'
  ).verified,
  1
);

console.log('\n--- the two columns span the card ---');
checkIs(
  'the library is two tracks, never three',
  /md:grid-cols-\[18rem_1fr\] lg:grid-cols-\[16rem_1fr\]/.test(moduleSource) &&
    !/grid-cols-\[15rem_16rem_1fr\]/.test(moduleSource),
  'a third track would reserve width for a reader that is not there'
);
checkIs(
  'and nothing is reserved for a body that is not open',
  /\{openId && \(\n\s+<div className="p-4 md:overflow-y-auto md:flex-1">/.test(moduleSource),
  'the list would still be squeezed by an empty pane'
);
checkIs(
  'so the "choose a document" placeholder is gone with it',
  !/Choose a document from the list to read it/.test(moduleSource)
);

// The regression guard for "I ticked some items and the verify card said nothing was waiting". The queue is built
// from the signatures `GET_DOCUMENT_SIGNATURES` returns, so the fields SIGN_CHECKLIST_ITEM WRITES are the contract:
// a member-role row, on a real item id, for the member who signed. Losing any one of them empties the card without
// an error anywhere - which is exactly how the bug presented.
const writtenSignature = {
  id: 'sig-1',
  document_id: 'doc-1',
  checklist_item_id: 'item-1',
  user_id: 'user-new',
  signed_by_user_id: 'user-new',
  signature_role: 'member',
  signed_at: '2026-07-01 08:00:00',
  content_revision: 3,
};
const queueItems = [{ id: 'item-1', label: 'Check the pump', section: '', sort_order: 0 }];
const queueSignatures = normalizeSignatureList([writtenSignature]);
check(
  'a member who signed an item is waiting to be verified',
  membersAwaitingVerification(queueItems, queueSignatures, 'user-officer').map((entry) => entry.userId),
  ['user-new']
);
check(
  'with the item they signed named',
  membersAwaitingVerification(queueItems, queueSignatures, 'user-officer')[0].remaining.map((state) => state.item.label),
  ['Check the pump']
);
check(
  'and the verifier\u2019s own signature is left out',
  membersAwaitingVerification(queueItems, queueSignatures, 'user-new'),
  []
);
check(
  'the fields the server writes survive the round trip',
  [
    queueSignatures[0].checklist_item_id,
    queueSignatures[0].signature_role,
    queueSignatures[0].document_id,
  ],
  ['item-1', 'member', 'doc-1']
);

console.log('\n--- verifying from Administration ---');
const verificationView = readFileSync(
  path.resolve(process.cwd(), 'src/components/admin/AdminChecklistVerification.jsx'),
  'utf8'
);
checkIs('the view exists and is rendered by the tab', /<AdminChecklistVerification/.test(tabSource));
checkIs(
  'it lists only the checklists',
  /\.filter\(\(row\) => row\.doc_type === 'checklist'\)/.test(verificationView),
  'a plain document would be offered, and would have nothing to confirm'
);
checkIs(
  'it shows the members who are waiting',
  /membersAwaitingVerification\(items, signatures, currentUserId\)/.test(verificationView),
  'a verifier could not tell who to look at'
);
checkIs(
  'and the queue for whichever member is open',
  /verificationQueue\(items, signatures, openMemberId\)/.test(verificationView)
);
checkIs(
  'each pending item is verified on its own',
  /verifyChecklistItem\(activeListId, itemId, openMemberId, token\)/.test(verificationView),
  'per-item verification is the whole point'
);
checkIs(
  'with a bulk form that asks first',
  /verifyChecklistRemaining\(activeListId, openMemberId, token\)/.test(verificationView) &&
    /<ConfirmModal/.test(verificationView),
  'a whole checklist would be confirmed by one click'
);
checkIs(
  'and every reload takes the server\u2019s answer',
  /setSignatures\(normalizeSignatureList\(result\.signatures\)\)/.test(verificationView),
  'the screen would guess instead of reading what was written'
);
checkIs(
  'the verifier is never offered their own checklist',
  /membersAwaitingVerification\(items, signatures, currentUserId\)/.test(verificationView) &&
    /currentUserId/.test(tabSource),
  'the self-verification the server refuses would be offered anyway'
);
checkIs(
  'and an empty list says WHY, rather than "nothing is waiting"',
  /emptyReason === 'no-items'/.test(verificationView) &&
    /emptyReason === 'nothing-signed'/.test(verificationView) &&
    /emptyReason === 'only-yours'/.test(verificationView) &&
    /emptyReason === 'all-verified'/.test(verificationView),
  'the case that looks like a bug - every signed item is the viewer\u2019s own - would read as broken'
);
checkIs(
  'including the rule that makes it look empty',
  /you cannot verify your[\s\S]{0,40}own checklist/.test(verificationView),
  'the self-verification rule is not explained where it bites'
);
checkIs(
  'and the picker says how many items each checklist has',
  /row\.item_count > 0[\s\S]{0,160}no items yet/.test(verificationView)
);

console.log('\n--- ordering is dragged, not typed ---');
checkIs('the Order box is gone from the editor', !/id="document-order"/.test(tabSource), 'there is still a number to type');
checkIs(
  'documents are draggable rows',
  /draggable=\{!savingOrder\}[\s\S]{0,200}startDocumentDrag\(event, row\)/.test(tabSource)
);
checkIs('and folder headings are draggable too', /startFolderDrag\(event, group\.folder\)/.test(tabSource));
checkIs(
  'a document drop asks the pure helper what the order should become',
  /reorderDocuments\(rows, movedId, row\.id\)/.test(tabSource),
  'the drop rule would be re-implemented in the component'
);
checkIs('and a folder drop asks the other one', /reorderFolders\(rows, movedFolder, folder\)/.test(tabSource));
checkIs(
  'the new order is saved as its own action',
  /adminReorderDocuments\(pairs, token\)/.test(tabSource)
);
checkIs(
  'the list is redrawn from what the sheet holds',
  /setRows\(normalizeDocumentList\(result\.documents\)\)/.test(tabSource)
);
checkIs(
  'Unfiled cannot be dragged',
  /draggable=\{group\.folder !== UNFILED_LABEL && !savingOrder\}/.test(tabSource)
);
checkIs(
  'and a drag across folders says why nothing moved',
  /A document cannot be dragged into another folder\./.test(tabSource)
);
checkIs(
  'Move up / Move down exist for the devices that cannot drag',
  /moveSelectedDocument\(-1\)/.test(tabSource) && /moveSelectedDocument\(1\)/.test(tabSource),
  'a touch screen would have no way to reorder at all'
);
checkIs(
  'and they move the selected document using the same helper',
  /reorderDocuments\(rows, form\.id, neighbour\.id\)/.test(tabSource) &&
    /orderedFolderDocuments\(rows, documentFolder\(form\)\)/.test(tabSource),
  'the buttons and a drag could disagree about what "up one" means'
);
checkIs(
  'with the ends disabled rather than wrapping',
  /disabled=\{savingOrder \|\| selectedIndex <= 0\}/.test(tabSource) &&
    /selectedIndex >= selectedSiblings\.length - 1/.test(tabSource)
);

// The frame comes in two sizes. Size is the FRAME, not the contract: the toolbar, the disabled fieldset and the
// blocked dismissal are asserted above, once, and hold for both.
check('the shell has a small frame and a large one', /small: 'sm:h-auto/.test(viewportModal) && /large: 'sm:h-\[92dvh\]/.test(viewportModal), true);
check('large is the default, so the other editors are unchanged', /size = 'large'/.test(viewportModal), true);
check('and an unknown size falls back to large rather than to no frame', /size === 'small' \? 'small' : 'large'/.test(viewportModal), true);
// The field-count rule lives in one place, beside the component, so it does not have to be re-argued per tab.
check('the rule is written down once', /SMALL_EDITOR_FIELD_LIMIT = 5/.test(viewportModal) && /export const editorModalSize/.test(viewportModal), true);
// A frame has a width of its own, so a grid inside it must key off the CONTAINER and not the viewport: this is
// the bug that squashed the timeclock fields on a desktop, in a panel narrower than the md breakpoint.
check('the body is a container, so field grids can measure the space they got', /@container relative min-h-0 flex-1 overflow-y-auto/.test(viewportModal), true);
check('and the small frame is wide enough for two columns', /small: 'sm:h-auto sm:max-h-\[85dvh\] sm:w-\[40rem\]/.test(viewportModal), true);
const clockTabSource = readFileSync('src/components/admin/AdminClockManagementTab.jsx', 'utf8');
check(
  'the timeclock editor asks for the small frame',
  /size="small"/.test(clockTabSource),
  true
);
// Sliced to the form itself: the filters card below it has its own three-column grid, which is the right shape
// for a card that spans the page and says nothing about the editor.
const clockFormStart = clockTabSource.indexOf('<form id={CLOCK_ENTRY_FORM_ID}');
const clockFormSource = clockTabSource.slice(
  clockFormStart,
  clockTabSource.indexOf('</form>', clockFormStart)
);
check(
  'and lays its fields out by container width, not viewport width',
  /@md:grid-cols-2/.test(clockFormSource) && !/md:grid-cols-3/.test(clockFormSource),
  true
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

