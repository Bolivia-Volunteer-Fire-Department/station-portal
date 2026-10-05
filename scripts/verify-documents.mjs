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
import AdminSignatureBackfill from '../src/components/admin/AdminSignatureBackfill.jsx';
import { ADMIN_PERMISSIONS, MEMBER_PERMISSIONS, allowedAdminTabs, permissionTab } from '../src/utils/permissions.js';
// The security rules, read as text. They are what actually decide a score can be written, and the assessment checks
// below assert the shape of that decision rather than trusting the client to have hidden the control. The emulator proof
// that they behave is in verify-rules.mjs.
const rulesSource = readFileSync('firestore.rules', 'utf8');
import { ADMIN_BAR_LABELS, PAGE_BAR_LABELS } from '../src/utils/pageLabels.js';
import {
  DOCUMENT_CONTENT_LIMIT,
  DOCUMENT_TYPES,
  EMPTY_DOCUMENT_FORM,
  UNFILED_LABEL,
  assessmentScoreDateLabel,
  assessmentScoreId,
  assessmentScoreLimit,
  assessmentScoreProblem,
  BACKFILL_NOTE_LIMIT,
  backfillCandidates,
  backfillItemStates,
  backfillSignaturePlan,
  backfillableItemIds,
  backfilledSignatureLabel,
  checklistItemSortOrder,
  editorChecklistItemRows,
  documentCharactersLeft,
  documentFolder,
  documentFolders,
  documentIsLive,
  documentLifecycle,
  documentLinkProblem,
  documentLinkUrl,
  documentOrderSignature,
  documentRequiresVerification,
  documentSaveProblem,
  documentsInFolder,
  documentSignatureState,
  documentToForm,
  documentUpdatedLabel,
  documentVerificationState,
  documentWindowLabel,
  filterDocuments,
  folderSummaries,
  groupDocumentsByFolder,
  isChecklist,
  isAssessment,
  isLink,
  memberAssessmentScore,
  memberSignatureFor,
  membersAwaitingDocumentVerification,
  normalizeChecklistItemList,
  normalizeAssessmentScore,
  normalizeDocument,
  normalizeDocumentList,
  normalizeSignatureList,
  outstandingSignatureDocuments,
  applyDocumentOrder,
  pendingDocumentOrderPairs,
  savedDocumentOrderPairs,
  insertDocumentBefore,
  reorderDocuments,
  reorderFolders,
  signatureDateLabel,
  signatureIsBackfilled,
  signatureIsStale,
  signatureRecordedLabel,
  signedDocumentIds,
  storedRequiresVerification,
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

// THE REPAIR SCRIPT'S DECISIONS, and the promise its own header makes - that it uses the app's expansion rather than a
// copy. `audience_keys` is MATERIALIZED at save time, so a document saved before the fix keeps its old single-rank list
// forever unless something re-derives it; scripts/normalize-document-audience.mjs is that something, and it writes to
// production. So its decisions are exercised here rather than trusted, including the ones that must decide NOT to write.
// This is the file that script's header names as the one that keeps it honest.
import { correctedAudienceKeys, isUnjudgeable } from './normalize-document-audience.mjs';
import { audienceKeysForWrite } from '../src/services/firestoreWrites.js';

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
// Four types now. `assessment` joined the list and this line said "three" with the old three spelled out, so it caught
// the addition rather than riding along with it - which is what a list assertion is for. The new type has its own block
// below.
check('link is one of the four types', DOCUMENT_TYPES, ['markdown', 'checklist', 'link', 'assessment']);
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
console.log('\n--- dropping into the gap between two documents ---');
// The position a drop ON a row cannot express. Dropping onto a row lands a document BESIDE it, with the side decided by
// the direction the drag travelled; a gap names its own position, so "between these two" and "at the end" are both
// sayable. Both drops number the run through the same helper, so the same visual position cannot save two orders.
check(
  'a gap between two documents puts the row exactly there',
  orderMap(insertDocumentBefore(withinAlpha, 'a3', 'Alpha', 'a2')),
  { a2: 20, a3: 10 }
);
check(
  'the gap above the first document puts it first',
  orderMap(insertDocumentBefore(withinAlpha, 'a3', 'Alpha', 'a1')),
  { a1: 10, a2: 20, a3: 0 }
);
check(
  'and the gap after the last one puts it last',
  orderMap(insertDocumentBefore(withinAlpha, 'a1', 'Alpha', '')),
  { a1: 20, a2: 0, a3: 10 }
);
// A FUMBLED DRAG: dropping a document back into the gap it is already sitting in. Every number it would be given is the
// number it already holds, so the pairs come back empty and nothing is written - the same rule that makes a drop onto a
// row it already touches harmless.
check('dropping a document into its own gap writes nothing', insertDocumentBefore(withinAlpha, 'a2', 'Alpha', 'a3'), []);
check('and the gap it already fills is not a move either', insertDocumentBefore(withinAlpha, 'a1', 'Alpha', 'a2'), []);
check('an unknown document writes nothing', insertDocumentBefore(withinAlpha, 'nope', 'Alpha', 'a1'), []);
check('and a gap naming no folder writes nothing', insertDocumentBefore(withinAlpha, 'a1', '', 'a2'), []);
// THE END GAP IS THE REASON THE FOLDER IS PASSED IN. It has no anchor to compare against, so without the folder check a
// document dragged from another folder would be renumbered inside its OWN folder by a drop that looked like it landed
// somewhere else entirely.
const twoFolders = normalizeDocumentList([
  { id: 'a1', title: 'A one', folder: 'Alpha', sort_order: 0 },
  { id: 'a2', title: 'A two', folder: 'Alpha', sort_order: 10 },
  { id: 'b1', title: 'B one', folder: 'Bravo', sort_order: 20 },
]);
check(
  'a document dragged from another folder is never renumbered by the end gap',
  insertDocumentBefore(twoFolders, 'b1', 'Alpha', ''),
  []
);
check(
  'nor by a gap in front of another folder document',
  insertDocumentBefore(twoFolders, 'a1', 'Bravo', 'b1'),
  []
);

console.log('\n--- the order that comes back is applied to the rows on screen ---');
// The other half of a drop: the reply carries a COUNT, so the list is redrawn from the pairs that were just written.
// Pure, and asserted by the thing that matters - what the officer ends up looking at.
const held = normalizeDocumentList([
  { id: 'a1', title: 'A one', folder: 'Alpha', sort_order: 10 },
  { id: 'a2', title: 'A two', folder: 'Alpha', sort_order: 0 },
]);
check(
  'a saved order moves the rows it names',
  applyDocumentOrder(held, [{ id: 'a1', sort_order: 0 }, { id: 'a2', sort_order: 10 }]).map((row) => [row.id, row.sort_order]),
  [['a1', 0], ['a2', 10]]
);
check(
  'and the list then reads that order',
  groupDocumentsByFolder(applyDocumentOrder(held, [{ id: 'a1', sort_order: 0 }, { id: 'a2', sort_order: 10 }])).flatMap(
    (group) => group.documents.map((row) => row.id)
  ),
  ['a1', 'a2']
);
// ...AND THE CHECK ABOVE CANNOT TELL, which is the reason the redraw fault got as far as it did. `held` is [a1, a2] and
// the dragged answer is [a1, a2], so a list drawn in arrival order passes it just as well as one drawn in `sort_order`.
// The fixture has to ARRIVE the other way round for the two answers to differ, and this is that fixture: the rows come
// in [b1, b2] and the drag puts b2 first, so arrival order says ['b1','b2'] and the rule says ['b2','b1'].
const arrivedBackwards = normalizeDocumentList([
  { id: 'b1', title: 'B one', folder: 'Bravo', sort_order: 0 },
  { id: 'b2', title: 'B two', folder: 'Bravo', sort_order: 20 },
]);
const draggedBackwards = applyDocumentOrder(arrivedBackwards, [
  { id: 'b1', sort_order: 20 },
  { id: 'b2', sort_order: 0 },
]);
check(
  'a drag moves a row on screen, not only in the numbers it wrote',
  groupDocumentsByFolder(draggedBackwards).flatMap((group) => group.documents.map((row) => row.id)),
  ['b2', 'b1']
);
check(
  'and this fixture arrives in the order a broken list would have shown',
  arrivedBackwards.map((row) => row.id),
  ['b1', 'b2']
);
// The input is never mutated, and an order that changes nothing returns the SAME list so React can skip the render -
// the rule utils/savedRow states for its own merges.
const heldBefore = JSON.stringify(held);
applyDocumentOrder(held, [{ id: 'a1', sort_order: 0 }, { id: 'a2', sort_order: 10 }]);
check('the list it was given is left alone', JSON.stringify(held), heldBefore);
check('an order that changes nothing hands back the same list', applyDocumentOrder(held, []) === held, true);
check(
  'and so does one naming only the rows that did not move',
  applyDocumentOrder(held, [{ id: 'a1', sort_order: 10 }]) === held,
  true
);
// ...AND IT CANNOT EMPTY THE LIST, which is the fault itself: a reply with no pairs - or an answer for a document that
// is no longer there - leaves every row exactly where it was.
check('a reply naming nothing leaves the list as it was', applyDocumentOrder(held, undefined).length, 2);
check(
  'and a pair for an unknown document changes no row',
  applyDocumentOrder(held, [{ id: 'ghost', sort_order: 0 }]) === held,
  true
);

// ---------------------------------------------------------------------------
// The staged order: what is waiting to be saved, and what a save sends.
//
// Reordering is "move as many rows as you like, then save once". These are the two questions that makes the screen ask
// over and over - what does the library look like now, and what is stored - so they are pure, and the bar's count and
// the request body both come from the same answer rather than from two tallies that could drift.
console.log('\n--- what is waiting to be saved ---');
const savedRows = normalizeDocumentList([
  { id: 'o1', title: 'One', folder: 'Ops', sort_order: 0 },
  { id: 'o2', title: 'Two', folder: 'Ops', sort_order: 10 },
  { id: 'o3', title: 'Three', folder: 'Ops', sort_order: 20 },
]);
const savedSignature = documentOrderSignature(savedRows);
check('the saved order is read as a signature', [...savedSignature].map(([id, order]) => [id, order]), [
  ['o1', 0],
  ['o2', 10],
  ['o3', 20],
]);
check('a list nobody has touched is waiting to save nothing', pendingDocumentOrderPairs(savedRows, savedSignature), []);

// One row moved to the top: the other two are renumbered by the drag helper, so all three are pending.
const movedToTop = applyDocumentOrder(savedRows, [
  { id: 'o1', sort_order: 10 },
  { id: 'o2', sort_order: 0 },
  { id: 'o3', sort_order: 20 },
]);
check(
  'a moved row is what is waiting, and only the rows whose number changed',
  pendingDocumentOrderPairs(movedToTop, savedSignature),
  [
    { id: 'o1', sort_order: 10 },
    { id: 'o2', sort_order: 0 },
  ]
);
check(
  'and the row that stayed put is not in the save',
  pendingDocumentOrderPairs(movedToTop, savedSignature).some((pair) => pair.id === 'o3'),
  false
);
// Measured against the SAVED order rather than against "was this touched" - so dragging a row back where it was leaves
// nothing to write, and the bar offering to save it goes away. Tracking "touched" would keep offering forever.
const putBack = applyDocumentOrder(movedToTop, [
  { id: 'o1', sort_order: 0 },
  { id: 'o2', sort_order: 10 },
]);
check('a drag that ends where it started is waiting to save nothing', pendingDocumentOrderPairs(putBack, savedSignature), []);
check('though the working list is a different array', putBack !== savedRows, true);
check('and it reads the same order again', groupDocumentsByFolder(putBack).flatMap((g) => g.documents.map((r) => r.id)), [
  'o1',
  'o2',
  'o3',
]);
// A blocked/absent snapshot must not report the whole library as changed: "nothing is stored" is not a state this
// screen is ever in, and treating it as one would offer to save every row on the station.
check('with no saved order to compare against, nothing is pending', pendingDocumentOrderPairs(savedRows, undefined), []);
check('and an empty list has nothing pending', pendingDocumentOrderPairs([], savedSignature), []);
check('a row the server has not sent back yet is not invented', pendingDocumentOrderPairs([{ id: 'ghost' }], savedSignature), []);
check(
  'Discard is the saved order as pairs, so it needs no read to undo',
  savedDocumentOrderPairs(savedSignature),
  [
    { id: 'o1', sort_order: 0 },
    { id: 'o2', sort_order: 10 },
    { id: 'o3', sort_order: 20 },
  ]
);
check(
  'and applying it puts a moved row back',
  groupDocumentsByFolder(applyDocumentOrder(movedToTop, savedDocumentOrderPairs(savedSignature))).flatMap((g) =>
    g.documents.map((row) => row.id)
  ),
  ['o1', 'o2', 'o3']
);
// The numbers are compared as numbers, so a row the server sent as a string is not reported as moved for ever.
check(
  'a sort_order that arrives as text is compared as a number',
  pendingDocumentOrderPairs([{ id: 'o1', sort_order: '0' }], savedSignature),
  []
);

// ---------------------------------------------------------------------------
// GRANDFATHERING: what a paper file becomes, and how the record stays honest
// ---------------------------------------------------------------------------
// The feature is "enter what the crew did before the app existed, from the files, for many people at once". The two
// things that have to be right are the ARITHMETIC - a back-filled row has to count as that member's signature
// everywhere, or grandfathering does not work - and the HONESTY - a row an officer entered must never read like one the
// member tapped.
console.log('\n--- back-filling from the paper files ---');
const backfillItems = [
  { id: 'b1', document_id: 'doc-bf', sort_order: 1, section: 'Exterior', label: 'Tires' },
  { id: 'b2', document_id: 'doc-bf', sort_order: 2, section: 'Exterior', label: 'Lights' },
  { id: 'b3', document_id: 'doc-bf', sort_order: 3, section: 'Cab', label: 'Radio check' },
];
const ana = 'u-ana';
const officer = 'u-officer';

// The ordinary shape: a member ticks an item themselves.
const anaOwn = {
  id: 'sg-own',
  document_id: 'doc-bf',
  checklist_item_id: 'b1',
  user_id: ana,
  signed_by_user_id: ana,
  signature_role: 'member',
  signed_at: '2026-03-01 09:00:00',
};
check('a member\u2019s own signature is not a back-fill', signatureIsBackfilled(anaOwn), false);

// The shape this feature writes.
const anaFilled = { ...anaOwn, id: 'sg-fill', checklist_item_id: 'b2', signed_by_user_id: officer, backfilled: true };
check('a row an officer entered is flagged as one', signatureIsBackfilled(anaFilled), true);
// ...AND THE FLAG IS NOT THE ONLY READING. A row written before the flag existed is recognisable by its shape - the one
// shape the rules always refused for a member - so old data reads correctly with no migration.
const anaOld = { ...anaFilled, id: 'sg-old', backfilled: undefined };
check('and so is one whose signer is not its owner, from before the flag existed', signatureIsBackfilled(anaOld), true);
check('while a row naming no signer at all is not one', signatureIsBackfilled({ ...anaOwn, signed_by_user_id: '' }), false);
check('a verification is not a back-filled signature', signatureIsBackfilled({ ...anaFilled, signature_role: 'verifier' }), false);

// THE ARITHMETIC THAT MAKES IT WORK: every screen that reads progress keys off role 'member', so a back-filled row has
// to read as the member's signature. Asserted rather than assumed, because it is the whole reason the row is shaped
// this way rather than being a fourth role.
check('a back-filled row counts as THAT member\u2019s signed item', checklistItemState('b2', [anaFilled], ana).signed, true);
check('and not as somebody else\u2019s', checklistItemState('b2', [anaFilled], officer).signed, false);
check('so the member\u2019s progress moves when it is written', checklistProgress(backfillItems, [anaFilled], ana).signed, 1);
check(
  'and a fully back-filled checklist is complete once confirmed',
  checklistIsComplete(
    backfillItems,
    backfillItems.flatMap((item) => [
      { ...anaFilled, id: `m-${item.id}`, checklist_item_id: item.id },
      { ...anaFilled, id: `v-${item.id}`, checklist_item_id: item.id, signature_role: 'verifier' },
    ]),
    ana
  ),
  true
);

// What the screen says about each item.
const bfStates = backfillItemStates(backfillItems, [anaOwn, anaFilled], ana);
check(
  'an item already on file is not offered again',
  bfStates.map((state) => [state.itemId, state.recorded]),
  [['b1', true], ['b2', true], ['b3', false]]
);
check(
  'and the screen says which kind of done it is',
  bfStates.filter((state) => state.recorded).map((state) => [state.itemId, state.signedByMember, state.backfilled]),
  [['b1', true, false], ['b2', false, true]]
);
check('an item with nothing on it is bare', bfStates[2].recorded, false);
check(
  'the state is asked for ONE member, so another member\u2019s rows are not counted',
  backfillItemStates(backfillItems, [anaOwn, anaFilled], 'u-other').some((state) => state.recorded),
  false
);

// THE SELECTION RULE, shared by the screen and the writer: what a save should write.
check(
  'only the ticked items that are not already on file are written',
  backfillableItemIds(backfillItems, [anaOwn, anaFilled], ana, ['b1', 'b2', 'b3']),
  ['b3']
);
check('an item the officer did not tick is not written', backfillableItemIds(backfillItems, [anaOwn, anaFilled], ana, ['b3']), ['b3']);
check('ticking nothing writes nothing', backfillableItemIds(backfillItems, [], ana, []), []);
check(
  'an item another checklist owns is refused',
  backfillableItemIds(backfillItems, [], ana, ['b1', 'somebody-elses-item']),
  ['b1']
);
check('and a double tick is one row, not two', backfillableItemIds(backfillItems, [], ana, ['b3', 'b3', ' b3 ']), ['b3']);
check('a member\u2019s own signature blocks a back-fill of the same item', backfillableItemIds(backfillItems, [anaOwn], ana, ['b1']), []);
check('but not for a different member', backfillableItemIds(backfillItems, [anaOwn], 'u-other', ['b1']), ['b1']);

// THE WHOLE-DOCUMENT MARKER, which is the EMPTY item id rather than an item: a plain document's acknowledgment is ONE
// row, so its panel asks for that id and nothing else. It is not checked against the document's items - a plain
// document has none, and there is nothing it could honestly be checked against - and it IS checked against what is
// already on file, because that is the rule every other id follows.
//
// This is where it broke: the selection dropped empty values on their way in, which dropped the one id a plain document
// has. "Record signature" then planned no rows at all and reported everything as already recorded.
check('a plain document asks for its own row, not for an item', backfillableItemIds([], [], ana, ['']), ['']);
check(
  'and a second press writes nothing, because one row per thing is the rule there too',
  backfillableItemIds([], [{ ...anaOwn, id: 'sg-whole', checklist_item_id: '' }], ana, ['']),
  []
);
check('while an item id is still checked against the document that owns it', backfillableItemIds([], [], ana, ['b1']), []);
const wholeDocumentPlan = backfillSignaturePlan({
  documentId: 'doc-plain',
  items: [],
  signatures: [],
  memberId: ana,
  recorderId: officer,
  itemIds: [''],
  at: '2025-05-01',
  revision: 4,
  confirmVerified: true,
});
check('so the plan writes the one row a plain document has', wholeDocumentPlan.member.length, 1);
check(
  'with the document on it and no item, which is what every reader looks for',
  [wholeDocumentPlan.member[0].document_id, wholeDocumentPlan.member[0].checklist_item_id],
  ['doc-plain', '']
);
check('and the confirmation beside it when the officer also confirmed it', wholeDocumentPlan.verifier.length, 1);

// The plan: the rows themselves, as data.
const plan = backfillSignaturePlan({
  documentId: 'doc-bf',
  items: backfillItems,
  signatures: [anaOwn],
  memberId: ana,
  recorderId: officer,
  itemIds: ['b2', 'b3'],
  at: '2025-05-01',
  revision: 7,
  note: 'Paper file',
  confirmVerified: true,
});
// THE ROW HAS TO BE WHOLE, not merely to have the fields this test happens to name. A signature is read back BY
// DOCUMENT on every screen, so a row missing `document_id` is attached to nothing: the write reports success, the row
// exists in the collection, and the item still reads as unrecorded everywhere. That exact bug shipped through the first
// version of these checks, which listed the fields they were interested in and never asked whether the row was complete
// - it was caught by the emulator round trip and by nothing else. So this asserts the whole shape.
check(
  'every row is whole: the document, the item, the member and the role',
  [...plan.member, ...plan.verifier].map((row) => [row.document_id, row.checklist_item_id, row.user_id, row.signature_role]),
  [
    ['doc-bf', 'b2', ana, 'member'],
    ['doc-bf', 'b3', ana, 'member'],
    ['doc-bf', 'b2', ana, 'verifier'],
    ['doc-bf', 'b3', ana, 'verifier'],
  ]
);
check(
  'and no field of a signature row is missing from either kind',
  [...plan.member, ...plan.verifier].every(
    (row) => row.document_id && row.user_id && row.signed_by_user_id && row.signature_role && row.signed_at
  ),
  true
);
check('the plan writes a member row per new item', plan.member.length, 2);
check(
  'each one counting for the member and attributed to the officer',
  plan.member.map((row) => [row.user_id, row.signed_by_user_id, row.signature_role]),
  [[ana, officer, 'member'], [ana, officer, 'member']]
);
check(
  'each one flagged as a back-fill, with the note and the moment it was entered',
  plan.member.map((row) => [row.backfilled, row.backfill_note, Boolean(row.backfilled_at)]),
  [[true, 'Paper file', true], [true, 'Paper file', true]]
);
check('and stamped with the date the officer gave', plan.member.map((row) => row.signed_at), ['2025-05-01', '2025-05-01']);
check(
  'with the document\u2019s revision, so a back-fill is never reported as stale',
  plan.member.map((row) => row.content_revision),
  [7, 7]
);
check(
  'and a verifier row for each, attributed to the same officer',
  plan.verifier.map((row) => [row.signature_role, row.user_id, row.signed_by_user_id, row.content_revision]),
  [['verifier', ana, officer, 0], ['verifier', ana, officer, 0]]
);
check('a verification carries no back-fill flag of its own', plan.verifier.every((row) => row.backfilled === undefined), true);
// The choice is real: with it off, the rows go to the ordinary verification queue instead.
const unverifiedPlan = backfillSignaturePlan({
  documentId: 'doc-bf',
  items: backfillItems,
  signatures: [],
  memberId: ana,
  recorderId: officer,
  itemIds: ['b1'],
  at: '2025-05-01',
});
check('leaving the confirmation off writes no verifier row', unverifiedPlan.verifier.length, 0);
check('though the signature is still written', unverifiedPlan.member.length, 1);
// A note is a note, not a body: the limit is applied rather than trusted, and the row still lands.
check(
  'a long note is trimmed rather than refused',
  backfillSignaturePlan({
    documentId: 'doc-bf',
    items: backfillItems,
    signatures: [],
    memberId: ana,
    recorderId: officer,
    itemIds: ['b1'],
    at: '2025-05-01',
    note: 'x'.repeat(BACKFILL_NOTE_LIMIT + 50),
  }).member[0].backfill_note.length,
  BACKFILL_NOTE_LIMIT
);
check(
  'and a plan with nothing new to write writes nothing',
  backfillSignaturePlan({
    documentId: 'doc-bf',
    items: backfillItems,
    signatures: [],
    memberId: ana,
    recorderId: officer,
    itemIds: [],
    at: '2025-05-01',
  }).member.length,
  0
);

// WHO THE PANEL OFFERS, which is the client half of the server's refusal. As a rule with cases rather than a filter in a
// dropdown, because a mutation test found the gap: a text check for the expression passed while `false &&` in front of
// it broke the behaviour, and every check stayed green.
check(
  'the member list is everyone except the officer doing the recording',
  backfillCandidates([{ id: 'u1', name: 'Jane' }, { id: 'u2', name: 'Bo' }], 'u1').map((user) => user.id),
  ['u2']
);
check('and a row with no id is not offered', backfillCandidates([{ id: '' }, { id: 'u2' }], 'u1').map((user) => user.id), ['u2']);
check('with nobody signed in, everyone is offered', backfillCandidates([{ id: 'u1' }, { id: 'u2' }], '').length, 2);
check('and a null list is an empty list, not a crash', backfillCandidates(null, 'u1'), []);

// How the record reads back and is labelled.
check(
  'the record says who entered it and for whom',
  backfilledSignatureLabel(anaFilled, 'Ana Ruiz', 'Jane Doe'),
  'Recorded by Jane Doe for Ana Ruiz'
);
check('a name that cannot be resolved still says where it came from', backfilledSignatureLabel(anaFilled), 'Recorded from paper records');
check('and a member\u2019s own signature gets no such label', backfilledSignatureLabel(anaOwn, 'Ana Ruiz', 'Ana Ruiz'), '');
check('a member\u2019s own date reads as "Signed"', signatureDateLabel(anaOwn), 'Signed Sun, Mar 1 2026 · 9:00 AM');
check('and a back-filled one says "Recorded"', signatureDateLabel(anaFilled, '12', 'Recorded'), 'Recorded Sun, Mar 1 2026 · 9:00 AM');
// A date-only stamp - which is what a back-fill is given - reads as a date and shows no clock, because there is no time
// of day to show: the paper says a day.
check('a date with no clock on it shows no clock', signatureDateLabel({ signed_at: '2025-05-01' }, '12', 'Recorded'), 'Recorded Thu, May 1 2025');
check(
  'signatureRecordedLabel labels only back-filled rows',
  [signatureRecordedLabel(anaFilled), signatureRecordedLabel(anaOwn)],
  ['Recorded Sun, Mar 1 2026 · 9:00 AM', '']
);

// ---------------------------------------------------------------------------
// THE SECOND SIGNATURE - a document whose author asked for its signature to be confirmed
// ---------------------------------------------------------------------------
// What a checklist does item by item, a document can do as a whole: the member signs, and somebody else confirms they
// looked. One rule decides which documents are in that arrangement, and both screens read the answer from it - so a
// document cannot sit in a verifier's list while the writer refuses the confirmation, or the other way round.
console.log('\n--- the second signature ---');
const secondSignature = {
  id: 'ss',
  title: 'Acknowledgment',
  doc_type: 'markdown',
  is_sign_required: true,
  requires_verification: true,
};
check('a signed document the author asked about needs a confirmation', documentRequiresVerification(secondSignature), true);
check(
  'a checklist never does - its items are what get confirmed',
  documentRequiresVerification({ ...secondSignature, doc_type: 'checklist' }),
  false
);
check(
  'nor does a document nobody signs',
  documentRequiresVerification({ ...secondSignature, is_sign_required: false }),
  false
);
check(
  'nor one whose author left the box unticked',
  documentRequiresVerification({ ...secondSignature, requires_verification: false }),
  false
);
check('the column is read off the row like every other flag', normalizeDocument({ requires_verification: 'TRUE' }).requires_verification, true);
check('a new document starts with it off', EMPTY_DOCUMENT_FORM.requires_verification, false);
check('and opening a stored one carries it', documentToForm(secondSignature).requires_verification, true);

// WHAT A SAVE MAY STORE, which is that rule one step earlier: the payload builder applies it, so a checklist cannot be
// written asking for its items to be confirmed twice over however the request was shaped.
check('a save keeps the box on a signed document', storedRequiresVerification(secondSignature), true);
check(
  'a checklist cannot be stored with it',
  storedRequiresVerification({ ...secondSignature, doc_type: 'checklist' }),
  false
);
check(
  'nor can an unsigned document',
  storedRequiresVerification({ ...secondSignature, is_sign_required: false }),
  false
);
check(
  'and a row that never mentioned it is false',
  storedRequiresVerification({ doc_type: 'markdown', is_sign_required: true }),
  false
);

const herSignature = {
  id: 'q1',
  document_id: 'ss',
  checklist_item_id: '',
  user_id: 'ana',
  signed_by_user_id: 'ana',
  signature_role: 'member',
  signed_at: '2026-03-01 09:00:00',
};
const hisSignature = { ...herSignature, id: 'q2', user_id: 'bo', signed_by_user_id: 'bo', signed_at: '2026-03-02 10:00:00' };
const herConfirmation = {
  ...herSignature,
  id: 'q3',
  signed_by_user_id: 'jane',
  signature_role: 'verifier',
  signed_at: '2026-03-03 11:00:00',
};
// An ITEM signature and an item verification on the same document. Neither is the document's own signature, and reading
// either as one would put a checklist's line into the count of who has signed the document.
const secondSignatureRows = [
  herSignature,
  hisSignature,
  herConfirmation,
  { ...herSignature, id: 'q4', checklist_item_id: 'it1' },
  { ...herConfirmation, id: 'q5', checklist_item_id: 'it1' },
];

check(
  'her signature and its confirmation are read as a pair',
  [
    documentVerificationState(secondSignatureRows, 'ss', 'ana').signed,
    documentVerificationState(secondSignatureRows, 'ss', 'ana').verified,
  ],
  [true, true]
);
check(
  'and the confirmation says who gave it, and when',
  [
    documentVerificationState(secondSignatureRows, 'ss', 'ana').verifiedByUserId,
    documentVerificationState(secondSignatureRows, 'ss', 'ana').verifiedAt,
  ],
  ['jane', '2026-03-03 11:00:00']
);
check(
  'a signature nobody has confirmed reads as signed but not confirmed',
  [
    documentVerificationState(secondSignatureRows, 'ss', 'bo').signed,
    documentVerificationState(secondSignatureRows, 'ss', 'bo').verified,
  ],
  [true, false]
);
check(
  'an item signature is not the document\u2019s own',
  documentVerificationState(secondSignatureRows, 'ss', 'ana').signedAt,
  '2026-03-01 09:00:00'
);
check(
  'nor does an item confirmation confirm it - the marker is the empty item on both sides',
  documentVerificationState(
    [
      { ...herSignature, checklist_item_id: 'it1' },
      { ...herConfirmation, checklist_item_id: 'it1' },
    ],
    'ss',
    'ana'
  ).verified,
  false
);
check(
  'and somebody who has not signed has neither',
  [
    documentVerificationState(secondSignatureRows, 'ss', 'cy').signed,
    documentVerificationState(secondSignatureRows, 'ss', 'cy').verified,
  ],
  [false, false]
);
check('another document\u2019s rows are not counted', documentVerificationState(secondSignatureRows, 'other', 'ana').signed, false);

// The queue a verifier works from - the same helper behind the administration panel and the module's own panel.
check(
  'the people waiting are those who signed and nobody confirmed',
  membersAwaitingDocumentVerification(secondSignature, secondSignatureRows, 'jane').map((entry) => entry.userId),
  ['bo']
);
check(
  'and each row carries the date the confirmation is being given against',
  membersAwaitingDocumentVerification(secondSignature, secondSignatureRows, 'jane')[0].signedAt,
  '2026-03-02 10:00:00'
);
check(
  'a verifier\u2019s own signature is not offered, because the server refuses self-verification',
  membersAwaitingDocumentVerification(secondSignature, [herSignature], 'ana'),
  []
);
check(
  'and a confirmed signature leaves the queue',
  membersAwaitingDocumentVerification(secondSignature, [herSignature, herConfirmation], 'jane'),
  []
);
check(
  'a document that does not ask for a confirmation has no queue at all',
  membersAwaitingDocumentVerification({ ...secondSignature, requires_verification: false }, secondSignatureRows, 'jane'),
  []
);


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
// IN sort_order, NOT IN ARRIVAL ORDER - and the fixture is built so the two answers differ: `a` (order 2) arrives before
// `c` (order 1), so a group drawn as the rows arrived would answer ['a', 'c'].
//
// THAT IS WHAT THIS ASSERTED. The expectation below read ['a', 'c'] for as long as the list was a bare `.filter()` of
// the array it was handed - so the check was not merely blind to the fault, it was holding it in place: it passed for
// exactly the reason the screen was wrong. The rule is `sort_order`, and the drawn order has to be the order a drag
// writes or a saved reorder comes back looking like it did nothing.
check(
  'the fixture disagrees with itself on purpose, so an arrival-order list fails this',
  rows.filter((row) => documentFolder(row) === 'General').map((row) => row.id),
  ['a', 'c']
);
check(
  'and grouped with their folder, in sort_order rather than the order they arrived in',
  groupDocumentsByFolder(rows).map((group) => [group.folder, group.documents.map((row) => row.id)]),
  [
    ['Apparatus', ['d']],
    ['General', ['c', 'a']],
    [UNFILED_LABEL, ['b']],
  ]
);
check(
  'which is the same order `documentsInFolder` gives for one folder',
  documentsInFolder(rows, 'General').map((row) => row.id),
  ['c', 'a']
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
// The Order box on a checklist item.
//
// The reported bug: an item given order 0 came back as 10. The box held a NUMBER whose empty state was also 0, so the
// save could only tell "left blank" from "typed 0" with `Number(value) || auto` - and `Number('0')` is falsy, so a
// deliberate 0 fell through to the auto-numbering and was moved to the next slot. The field holds TEXT now, and this
// is what turns it into the number to store.
console.log('\n--- what an author typed for the order ---');
check('a typed 0 is the number 0, not a blank box', checklistItemSortOrder('0', 999), 0);
check('and a blank box is the fallback', checklistItemSortOrder('', 999), 999);
check('nor is a box of spaces a zero', checklistItemSortOrder('   ', 999), 999);
check('nor is one nobody has touched', checklistItemSortOrder(undefined, 999), 999);
check('a 10 is a 10', checklistItemSortOrder('10', 999), 10);
check('and a 0 with spaces round it is still a 0', checklistItemSortOrder(' 0 ', 999), 0);
check('text that is not a number takes the fallback rather than becoming a 0', checklistItemSortOrder('later', 999), 999);
// The fallback is how the two saves differ: a new checklist numbers from its place in the list, an existing one has no
// sensible invented number at all - but NEITHER may override a number the author typed.
check('a new item left blank follows the list, ten apart', checklistItemSortOrder('', (3 + 1) * 10), 40);
check('an existing item left blank does not invent an order', checklistItemSortOrder('', 0), 0);
// The staged entry holds a resolved NUMBER by the time it is flushed to the server, so the flush has to pass a real 0
// through unchanged - this is the half of the bug that would survive fixing only the input.
check('a staged item at 0 is written as 0 when the document is created', checklistItemSortOrder(0, 0), 0);
check('and a staged item at 10 stays at 10', checklistItemSortOrder(10, 0), 10);

// ---------------------------------------------------------------------------
// The rows the item card draws.
//
// The reported fault: after saving a checklist, "New document" drew the saved checklist's items under the new one. This
// is the rule that decides what that card holds, and the case that was wrong is the third check below - a document
// with no id has no stored rows, whatever the tab is still holding.
console.log('\n--- what the checklist item card draws ---');
const savedItemRows = [
  { id: 'it1', document_id: 'doc-checklist', sort_order: 1, label: 'Fluids topped up' },
  { id: 'it2', document_id: 'doc-checklist', sort_order: 2, label: 'Lights tested' },
];
const stagedItemRows = [
  { id: 'staged-1-1', label: 'Radio check', section: '', sort_order: 10 },
  { id: 'staged-2-2', label: 'Beacon check', section: '', sort_order: 20 },
];

check(
  'an existing checklist draws its stored rows',
  editorChecklistItemRows(savedItemRows, [], true).map(({ item }) => item.id),
  ['it1', 'it2']
);
check(
  'and marks every one of them stored',
  editorChecklistItemRows(savedItemRows, [], true).map(({ staged }) => staged),
  [false, false]
);
check(
  'a NEW document draws none of the stored rows, whatever the tab still holds',
  editorChecklistItemRows(savedItemRows, [], false),
  []
);
check(
  'so a new checklist with nothing typed yet has no rows at all',
  editorChecklistItemRows(savedItemRows, [], false).length,
  0
);
check(
  'and it draws only what the author has typed into it, marked not saved yet',
  editorChecklistItemRows(savedItemRows, stagedItemRows, false).map(({ item, staged }) => [item.id, staged]),
  [['staged-1-1', true], ['staged-2-2', true]]
);
check(
  'an existing checklist shows stored rows first, then anything not yet written',
  editorChecklistItemRows(savedItemRows, stagedItemRows, true).map(({ item, staged }) => [item.id, staged]),
  [['it1', false], ['it2', false], ['staged-1-1', true], ['staged-2-2', true]]
);
// Typed with the LARGER order first, so a helper that sorted by `sort_order` would answer in the other sequence. The
// author's order of typing is what the card has always shown, and it is what makes staging readable.
check(
  'staged rows keep the order they were typed in rather than their order numbers',
  editorChecklistItemRows(
    [],
    [
      { id: 'typed-first', label: 'Typed first', sort_order: 99 },
      { id: 'typed-second', label: 'Typed second', sort_order: 0 },
    ],
    false
  ).map(({ item }) => item.id),
  ['typed-first', 'typed-second']
);
check('a list that never arrived is an empty list, not a crash', editorChecklistItemRows(undefined, undefined, true), []);
check('and neither is one holding something other than rows', editorChecklistItemRows(null, 'nonsense', false), []);

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
// ORDER, not a character budget. This check used to allow a fixed 200-character window between the open and the
// request, and the window closed when a comment was added in between: the ordering was right the whole time and
// the check went red only because the distance had grown. What it means to assert is that the open comes BEFORE
// the request is made, so this compares their positions - which no comment, call or blank line can falsify.
check(
  'it opens before the fetch, so the wait belongs to the modal',
  documentsTab.indexOf('setEditorOpen(true)') > -1 &&
    documentsTab.indexOf('setEditorOpen(true)') < documentsTab.indexOf('adminFetchDocument(id, token)'),
  true
);
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
// Four document types now. The options are built from DOCUMENT_TYPES (imported above), so these assert the labels the
// editor actually renders rather than the labels existing somewhere - and the regexes match the ternary's arms, which is
// why reformatting that chain into more lines is a change this file has to be told about.
checkIs('the type list offers a Link', /type === 'link'[\s\S]{0,80}?'Link'/.test(documentsTab));
checkIs(
  'and an Assessment',
  /type === 'assessment'[\s\S]{0,80}?'Assessment'/.test(documentsTab),
  'the editor offers no Assessment type, so one cannot be created'
);

// A role that may VERIFY but not MANAGE gets the verification view on its own - no editor, and no list to click
// through to one.
const verifierTabHtml = renderToString(
  React.createElement(AdminDocumentsTab, { token: 't1', canVerifyDocuments: true })
);
checkIs('a verifier gets the verification view', /Verify signatures/.test(verifierTabHtml));
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

// -----------------------------------------------------------------------------------------------------------
// THE "VIEW AS" PICKER MUST NOT DEPEND ON ANOTHER SCREEN HAVING BEEN OPENED.
// -----------------------------------------------------------------------------------------------------------
// The reported fault: the ability to select another member "is really inconsistent - sometimes the dropdown is there,
// sometimes it isn't", and as an administrator it currently was not.
//
// The control is gated on `canVerify && viewableMembers.length > 0`, and `viewableMembers` is built from the `users`
// PROP. That prop was `users` in App.jsx - a state filled only by the Administration Members tab's section read and by the
// applier after a member save. The Documents module is not an Administration sub-tab, so opening it read neither: an
// administrator who went straight to Documents got an empty list, the picker was hidden, and the same officer who had
// visited Administration first got it. The control was borrowing another screen's side effect.
//
// So two halves. Below: the module must actually draw the picker when it IS given members, and must not draw one when
// it is not (that is not a bug, it is what "no list" honestly looks like). And in App.jsx: the module must be given a
// list that does not depend on where the officer has been.
const officers = [
  { id: 'user-officer', name: 'Ada Quinn', rank_id: 'k1' },
  { id: 'user-ff', name: 'Bo Jones', rank_id: 'k2' },
];
const pickerHtml = renderToString(
  React.createElement(DocumentsModule, {
    token: 't1',
    currentUser: { id: 'user-officer' },
    users: officers,
    canVerify: true,
  })
);
checkIs('given a member list, a verifier is offered the picker', /aria-label="View another member&#x27;s records"/.test(pickerHtml));
checkIs('and it lists the other members by name', /Bo Jones/.test(pickerHtml));
checkIs(
  'and never the reader themselves',
  !/value="user-officer"/.test(pickerHtml),
  'the picker offered the reader their own records'
);
const noListHtml = renderToString(
  React.createElement(DocumentsModule, { token: 't1', currentUser: { id: 'user-officer' }, users: [], canVerify: true })
);
checkIs(
  'with no list it draws nothing rather than an empty picker',
  !/aria-label="View another member&#x27;s records"/.test(noListHtml),
  'an empty picker was rendered'
);
// ...which is exactly why the module must never be handed an empty list. This is the App.jsx half, read as source.
checkIs(
  'the Documents module is handed the directory, not the Administration-only `users` state',
  /users=\{documentsMembers\}/.test(appSource) &&
    /const documentsMembers = directory\.length \? directory : users;/.test(appSource),
  'the module is still wired to `users`, which only Administration fills'
);
checkIs(
  'and the directory is read when the documents tab opens',
  /activeTab !== 'documents'\) return;[\s\S]*?fetchAdminSections\(\['directory'\]\)/.test(appSource),
  'nothing reads the directory for the Documents module'
);
checkIs(
  'and only for the two roles that can actually use the picker',
  /if \(!canVerifyDocuments && !canAddAssessmentScores\) return;/.test(appSource),
  'the read is not limited to the roles that name members'
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

// The Order box, which is the other half of the order bug: the pure helper above is only correct if the screen actually
// holds the TEXT and reads it through the helper. A source check is what it takes, because the fault left no trace -
// the form held a number, every line read correctly, and the only way to see it was to type a 0.
checkIs(
  'the Item Order box holds what was typed rather than a parsed number',
  /value=\{itemForm\.sort_order\}[\s\S]{0,200}sort_order: event\.target\.value/.test(itemEditorSource),
  'parsing on each keystroke is what made a 0 and a blank box the same value'
);
checkIs(
  'and the empty form is blank rather than a zero',
  /EMPTY_ITEM_FORM = \{[^}]*sort_order: ''/.test(itemEditorSource),
  'a new item would start with a 0 that means the same as an empty box'
);
checkIs(
  'so the order the author typed is what is read at the save',
  /checklistItemSortOrder\(itemForm\.sort_order/.test(itemEditorSource),
  'the save would go back to turning a typed 0 into the next slot'
);
checkIs(
  'with a blank new item following the list and a blank existing one inventing nothing',
  /checklistItemSortOrder\(itemForm\.sort_order, \(stagedItems\.length \+ 1\) \* 10\)/.test(itemEditorSource) &&
    /checklistItemSortOrder\(itemForm\.sort_order\)/.test(itemEditorSource),
  'one of the two saves would substitute an order of its own'
);
// The flush reads the order through the same helper rather than a second reading of the field. Same reason as the check
// above: a staged entry already holds a resolved number, so both readings agree today - what is being pinned is that one
// field has ONE reader, which is what stops the next change from reintroducing a second, subtly different rule.
checkIs(
  'the staged items are written through the same reading of the order, not a second one',
  /checklistItemSortOrder\(item\.sort_order\)/.test(itemEditorSource),
  'the order field would have two readers that could drift apart'
);
// This one is a CONTRACT check rather than a bug: the save tolerates a number here (it stringifies before parsing), so
// filling the box with the raw number works today. It is still worth pinning, because a form field that holds text
// everywhere except one path is precisely the shape that let a blank box and a typed 0 become the same value.
checkIs(
  'and reopening an item fills the box as text, like every other path in this form',
  /sort_order: String\(item\.sort_order/.test(itemEditorSource),
  'one path would hold a number in a field the rest of the form treats as text'
);
checkIs(
  'the old `|| a default` reading is gone from the item save',
  !/sort_order: Number\(/.test(itemEditorSource),
  'a 0 would be treated as absent again'
);

// The editor holds facts about ONE document, and it has to blank them as it opens the next one. The reported fault was
// the item list: "New document" after saving a checklist kept the saved one's rows, because `items` is filled by the
// signatures read - which a document with no id never makes - so nothing was ever going to overwrite them.
checkIs(
  'opening a document blanks what the last one left behind',
  /const resetEditorState = \(\) => \{[\s\S]{0,700}setItems\(\[\]\)[\s\S]{0,300}setStagedItems\(\[\]\)/.test(
    itemEditorSource
  ),
  'the item list and the staged items would carry over from the document opened last'
);
checkIs(
  'and the item form and both pending removals with it',
  /resetEditorState = \(\) => \{[\s\S]{0,900}setItemForm\(EMPTY_ITEM_FORM\)[\s\S]{0,300}setPendingItemRemoval\(null\)[\s\S]{0,300}setPendingSignatureRemoval\(null\)/.test(
    itemEditorSource
  ),
  'a half-typed item or a row about to be removed would be left over from the previous document'
);
// WHERE it is blanked is the part that has to be pinned, because the new-document path RETURNS before the request: a
// reset placed after that branch would run for every case except the one that has no request to reset it for us.
checkIs(
  'and that happens before the new-document branch, which returns early',
  /resetEditorState\(\);[\s\S]{0,300}if \(!id\) \{[\s\S]{0,80}setForm\(EMPTY_DOCUMENT_FORM\);/.test(itemEditorSource),
  'a new document would open on the previous one items, which is the reported fault'
);
checkIs(
  'the editor blanks them when the document it is showing is deleted too',
  /setForm\(EMPTY_DOCUMENT_FORM\);[\s\S]{0,80}resetEditorState\(\);/.test(itemEditorSource),
  'the item card would still draw the rows of the document just removed'
);
// And the card is prevented from showing a leak even if one ever reaches the state again: it asks one helper what it
// holds, so the rows, the count and the empty message cannot disagree - and that helper refuses stored rows for a
// document with no id. See `editorChecklistItemRows`, whose rule is exercised above.
checkIs(
  'the item card asks one helper what it holds',
  /editorChecklistItemRows\(items, stagedItems, isEditing\)/.test(itemEditorSource) &&
    /itemRows\.map\(\(\{ item, staged \}\)/.test(itemEditorSource),
  'the card would go back to reading items and staged items separately'
);
checkIs(
  'with the heading count and the empty message from that same answer',
  /storedItemCount/.test(itemEditorSource) &&
    /itemRows\.length === 0/.test(itemEditorSource) &&
    !/\[\.\.\.items, \.\.\.stagedItems\]/.test(itemEditorSource),
  'the count could disagree with the rows drawn under it'
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

// THE CHECKBOX ITSELF, and the screens that act on it. What is asserted here is the pair of facts a screenshot cannot
// show: that the option is only OFFERED where it can mean something, and that the column a save writes is decided by
// the shared rule rather than by whatever the form happened to hold.
const apiSource = readFileSync(path.resolve(process.cwd(), 'src/services/api.js'), 'utf8');
checkIs(
  'the editor offers the second signature on a document',
  /A verifier must confirm the signature/.test(tabSource),
  'the option the whole feature hangs on is not on the form'
);
// A POSITIONAL assertion rather than a character budget: the guard and the label are ~40 lines apart with a comment
// between them, and a `{0,400}` window broke the moment the comment grew - which is exactly the brittleness the
// back-fill checks were converted away from. What matters is only that the checkbox comes AFTER its guard.
const secondSignatureGuard = tabSource.indexOf("{form.doc_type !== 'checklist' && (");
checkIs(
  'and never on a checklist, whose items are what get confirmed',
  secondSignatureGuard !== -1 &&
    tabSource.indexOf('A verifier must confirm the signature') > secondSignatureGuard,
  'a checklist would be offered a confirmation of a signature it does not have'
);
checkIs(
  'it is disabled until the document is signed, and says why',
  /disabled=\{!form\.is_sign_required\}/.test(tabSource) &&
    /Turn on \u201cMembers must sign this\u201d first/.test(tabSource),
  'an author would be left to guess why the box is not available'
);
checkIs(
  'and turning the signature off takes the requirement with it',
  /requires_verification: on \? current\.requires_verification : false/.test(tabSource),
  'a stored setting would describe a confirmation of nothing'
);
checkIs(
  'the column a save writes comes from the shared rule, not from the form',
  /requires_verification: storedRequiresVerification\(documentData\)/.test(apiSource),
  'a checklist could be stored asking for its items to be confirmed twice over'
);
checkIs(
  'the module reads the confirmation for the member whose records are on screen',
  /documentVerificationState\(recordSignatures, openDocumentId, recordUserId\)/.test(moduleSource),
  'a signed document would read the same whether or not anybody had confirmed it'
);
checkIs(
  'and says which of the two it is',
  /Waiting for a verifier to confirm your signature/.test(moduleSource) &&
    /checklistVerifiedLabel\([\s\S]{0,80}shownVerification/.test(moduleSource),
  'the reader is not told whether their signature is confirmed'
);
checkIs(
  'the verification panel is drawn for a checklist OR a document that asks',
  /canVerify && \(isChecklist\(openDocument\) \|\| documentNeedsConfirmation\)/.test(moduleSource),
  'a document asking for a confirmation would have no panel to confirm it from'
);
checkIs(
  'and it confirms the document through its own action',
  /verifyDocumentSignature\(documentId, memberId, token\)/.test(moduleSource) &&
    /membersAwaitingDocumentVerification\(openDocument/.test(moduleSource),
  'the panel would offer nothing to act on'
);
const routingSource = readFileSync(path.resolve(process.cwd(), 'src/services/firestoreRouting.js'), 'utf8');
checkIs(
  'which is declared in the documents feature and dispatched',
  /writes: \[[\s\S]{0,400}'VERIFY_DOCUMENT_SIGNATURE'/.test(routingSource) &&
    /VERIFY_DOCUMENT_SIGNATURE: async \(body, uid\)/.test(routingSource),
  'the action would be a route that throws, or one nothing lists'
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
  'it offers the checklists AND the documents that ask for a confirmation',
  /doc_type === 'checklist' \|\| documentRequiresVerification\(row\)/.test(verificationView),
  'a document asking for its signature to be confirmed would never appear, and a plain one that does not ask would'
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
  /you cannot verify your[\s\S]{0,60}checklist/.test(verificationView),
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
// THE GAPS BETWEEN THE DOCUMENTS - the request that added them: dropping ONTO a row can only put a document beside it,
// with the side decided by the direction of the drag, so there was no way to say "between these two" and no way at all
// to say "at the end" except by aiming at the last row from above.
checkIs(
  'a gap between two documents asks the insert helper where it goes',
  /insertDocumentBefore\(rows, movedId, folder, beforeId\)/.test(tabSource),
  'the gap rule would be re-implemented in the component'
);
checkIs(
  'the gaps are drawn before every document and once after the last one',
  /insertGap\(group\.folder, row\.id\)/.test(tabSource) && /insertGap\(group\.folder, ''\)/.test(tabSource),
  'there is no place to drop a document between two others'
);
checkIs(
  'and a gap names itself by the folder and the document it comes before',
  /const gapKey = \(folder, beforeId\) => `\$\{folder\}\|\$\{beforeId\}`/.test(tabSource),
  'a blank end-gap in one folder would be the same gap as a blank end-gap in another'
);
// ON ONE TARGET AT A TIME. The row ring and the gap bar are two answers to "where is this landing", and both lit would
// say the document is going to two places at once. Asserted against the GAP'S OWN BODY, so "somewhere in this file the
// right two setters appear" cannot satisfy it.
const insertGapBody = (() => {
  const at = tabSource.indexOf('const insertGap = (folder, beforeId) => {');
  return at < 0 ? '' : tabSource.slice(at, tabSource.indexOf('\n  };', at));
})();
checkIs('the gap is drawn by a function of its own', insertGapBody.length > 0, 'no insertGap to read');
checkIs(
  'hovering a gap clears the row highlight, so only one target is ever lit',
  /setDragOverDocumentId\(''\)/.test(insertGapBody) && /setDragOverInsert\(key\)/.test(insertGapBody),
  insertGapBody.slice(0, 200)
);
checkIs(
  'and hovering a row clears the gap',
  /setDragOverInsert\(''\);[\s\S]{0,60}setDragOverDocumentId\(row\.id\)/.test(tabSource),
  'both highlights can be lit at once'
);
// A FOLDER IS NOT DROPPED INTO A GAP. A folder drag's targets are the headings; a gap that answered one would renumber
// documents by a drop that looked like it was moving a folder. Not calling preventDefault is what makes it not a target
// at all - a dragover that is not prevented fires no drop.
checkIs(
  'and a gap ignores a folder being carried',
  /if \(!draggingDocumentId\) return;[\s\S]{0,40}event\.preventDefault\(\)/.test(insertGapBody),
  'a folder drag would be caught by the space between two rows'
);
checkIs(
  'the new order is saved as its own action',
  /adminReorderDocuments\(pairs, token\)/.test(tabSource)
);
// THE LIST IS NEVER TAKEN FROM THE REORDER'S REPLY, which is the fault this replaced.
//
// A reorder answers with a COUNT (`{ moved }`), not with the library - and the tab used to redraw itself from
// `result.documents`, a field no writer returns. `normalizeDocumentList(undefined)` is `[]`, so EVERY drop emptied the
// list on screen while the write had already succeeded: the documents came back, correctly ordered, the next time the
// tab was opened. A source check could not see it, because the line it pinned was the line that had the bug in it and
// it reads perfectly well - "the list is redrawn from what the sheet holds" was the intent, and the field it named was
// simply absent.
//
// So the assertion is the RULE rather than the shape of the call: the reply is not a list, therefore the list cannot
// come from it. The order the officer dragged is applied to the rows already held (`applyDocumentOrder`), which is the
// same answer - the pairs ARE what the writer numbered - without a read.
checkIs(
  'the order is applied to the rows already on screen',
  /setRows\(\(current\) => applyDocumentOrder\(current, pairs\)\)/.test(tabSource),
  'the dragged order is not what the list is redrawn from'
);
checkIs(
  'and the list is never rebuilt from the reorder reply, which carries no documents',
  !/setRows\(normalizeDocumentList\(result\./.test(tabSource),
  'a reorder reply has no `documents` - reading it empties the list'
);
checkIs(
  'which is a rule in utils/documents rather than a line in the component',
  /export const applyDocumentOrder = \(documents, pairs\)/.test(readFileSync('src/utils/documents.js', 'utf8'))
);
// ...AND THE ROW ORDER ON SCREEN IS `sort_order`. This is the half that was still missing after the fix above: the pairs
// were applied to the rows, the rows kept their numbers, and NOTHING MOVED - because the list was drawn as the array
// happened to be laid out, which only a re-read changes. The officer saw the change after leaving the tab and coming
// back, which is precisely the shape of "the drag is broken". `documentsInFolder` is the one definition of the drawn
// order, and the drag helpers already used it to work out where a row should land.
checkIs(
  'and the rows are drawn in that order rather than in the order they arrived',
  /export const documentsInFolder = \(documents, folder\) => orderedFolderDocuments\(documents, folder\)/.test(
    readFileSync('src/utils/documents.js', 'utf8')
  ),
  'a drop would write the right numbers and move nothing on screen'
);
checkIs(
  'so the grouping the list is drawn from goes through it',
  /groupDocumentsByFolder[\s\S]{0,220}documentsInFolder\(documents, folder\)/.test(
    readFileSync('src/utils/documents.js', 'utf8')
  ),
  'the rows under a heading would be in arrival order again'
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

// ---------------------------------------------------------------------------
// Make all the changes, then save once.
//
// A drag used to be a request. Ordering a shelf is one job, and a request per nudge made the officer wait on the network
// between each move, left a half-applied order behind if the third one failed, and never let them see the finished list
// before committing to it. Nothing is written until Save order now, and the moves survive the tab being closed.
console.log('\n--- making all the changes, then saving once ---');
// The half that matters: a drop and the two buttons STAGE. If any of them called the writer directly, one of the five
// ways to move a row would save on its own again - and it would be the one nobody tested.
const stageCalls = (tabSource.match(/stageOrder\(pairs\)/g) || []).length;
check('all four ways to move a row go through the one stage (a drop on a row, a gap, a folder, and the buttons)', stageCalls, 4);
checkIs(
  'and none of them still writes as it goes',
  !/applyOrder\(/.test(tabSource),
  'a drop would save on its own, with no way to see the finished list first'
);
// ONE WRITER, COUNTED. Counting the staging calls says every move goes through the stage; it does NOT say a move cannot
// write as well - a stray `adminReorderDocuments` beside a `stageOrder` leaves all four calls in place and still saves on
// the drop. This is the half that closes it: there is exactly one place in this tab that writes an order.
check(
  'and there is exactly one writer of the order in the whole tab',
  (tabSource.match(/adminReorderDocuments\(/g) || []).length,
  1
);
checkIs(
  'staging applies the pairs to the rows and writes nothing',
  /const stageOrder = useCallback\([\s\S]{0,320}setRows\(\(current\) => applyDocumentOrder\(current, pairs\)\)[\s\S]{0,80}\[savingOrder\]/.test(
    tabSource
  ),
  'the moved row would not appear in its new place until a reload'
);
// ONE REQUEST, EVERY ROW THAT MOVED. The pairs are the difference between the screen and the server, so the request body
// is that difference rather than a working copy of the library.
checkIs(
  'and one save sends every row that moved',
  /const saveOrder = useCallback\([\s\S]{0,320}adminReorderDocuments\(pairs, token\)/.test(tabSource),
  'the save would not be one request'
);
checkIs(
  'with the pending pairs as the request body, worked out in utils rather than counted here',
  /const pairs = pendingOrder;/.test(tabSource) &&
    /pendingDocumentOrderPairs\(rows, savedOrder\)/.test(tabSource),
  'the count in the bar and the request body could disagree'
);
checkIs(
  'and the saved order becomes the list the officer is looking at, so the bar clears',
  /setSavedOrder\(documentOrderSignature\(rows\)\)/.test(tabSource),
  'the bar would keep offering to save changes that had just landed'
);
checkIs(
  'Discard puts the stored numbers back without a read',
  /discardOrder[\s\S]{0,200}savedDocumentOrderPairs\(savedOrder\)/.test(tabSource),
  'undoing a mistake would cost a request'
);
// The bar carries the buttons and the count, and the count is that same pending list - not a separate tally.
checkIs(
  'the bar is what offers the save, and it counts the pairs a save would send',
  /orderDirty \? \(/.test(tabSource) &&
    /pendingOrder\.length\} unsaved change/.test(tabSource) &&
    /onClick=\{saveOrder\}/.test(tabSource) &&
    /onClick=\{discardOrder\}/.test(tabSource),
  'nothing would say what is waiting, or offer to save it'
);
checkIs(
  'and it says the changes survive leaving the tab',
  /Kept if you switch tabs/.test(tabSource),
  'an officer would reasonably assume a tab switch silences the work'
);
// THE MODAL COVERS THE BAR. Move up / Move down live inside the editor, so the one path a touch screen can use would
// stage a move with no way to see or save it - the bar is on the page behind the modal, and nothing else in there said
// anything was waiting. The count and the button sit beside those two buttons, off the same `pendingOrder`.
checkIs(
  'the editor says how many moves are waiting',
  /move\{pendingOrder\.length === 1 \? '' : 's'\} not saved/.test(tabSource),
  'a tablet could move a row and never be told anything was waiting'
);
// COUNTED AND POSITIONED rather than matched with a distance budget: "the save appears twice at least" plus "the one in
// the editor comes after the move buttons" is the claim, and neither depends on how long the markup between them is.
check(
  'so the save is offered in two places: the bar, and beside Move up / Move down',
  (tabSource.match(/onClick=\{saveOrder\}/g) || []).length,
  2
);
check(
  'and the one inside the editor comes after the two buttons it belongs to',
  tabSource.indexOf('onClick={saveOrder}', tabSource.indexOf('moveSelectedDocument(1)')) > tabSource.indexOf('moveSelectedDocument(1)'),
  true
);
// AN UNSAVED ORDER OUTLIVES THE UNMOUNT, which is the part a staged pattern has to get right: switching Administration
// tabs tears this one down, and losing the arrangement silently is exactly the quiet failure staging is meant to avoid.
checkIs(
  'an unsaved order is kept in sessionStorage, so a tab switch does not throw it away',
  /ORDER_DRAFT_KEY = 'documents\.order\.draft'/.test(tabSource) &&
    /sessionStorage\.setItem\(ORDER_DRAFT_KEY, JSON\.stringify\(pendingOrder\)\)/.test(tabSource) &&
    /sessionStorage\.removeItem\(ORDER_DRAFT_KEY\)/.test(tabSource),
  'the order would be lost by leaving the tab, with nothing said'
);
checkIs(
  'and it is read back once, onto the rows that arrive',
  /const draft = draftReadRef\.current \? pendingOrderRef\.current : readOrderDraft\(\);/.test(tabSource) &&
    /setRows\(draft\.length > 0 \? applyDocumentOrder\(fresh, draft\) : fresh\)/.test(tabSource),
  'a stored order would never be restored, or would be restored over a finished one'
);
// A reload must not undo the arrangement: every save in this tab reloads the library, and so does the mount.
checkIs(
  'a reload lays the working order over the rows rather than replacing it',
  /const fresh = await loadRows\(\);/.test(tabSource) &&
    /setSavedOrder\(documentOrderSignature\(fresh\)\)/.test(tabSource),
  'saving a document would silently put the staged rows back where the server has them'
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

// -----------------------------------------------------------------------------------------------------------
// ASSESSMENTS: a document that also carries one score per member.
// -----------------------------------------------------------------------------------------------------------
// The requirement, in one sentence: every member sees the assessment and can read their OWN score, nobody can write
// their own score, and only somebody with "Add assessment scores" can write one - for somebody else.
//
// These checks cover the pure half of that (the shapes, the id, the validation, the per-member lookup). The half that
// actually decides it - that a member's write is refused - lives in firestore.rules, asserted at the end of this block
// and proved against the emulator by verify-rules.mjs.
console.log('\n--- assessments ---');
check('an assessment is recognized', isAssessment({ id: 'a', doc_type: 'assessment' }), true);
check('and a document is not', isAssessment({ id: 'd', doc_type: 'markdown' }), false);
check('nor is a checklist', isAssessment({ id: 'c', doc_type: 'checklist' }), false);
// An unrecognized type still falls back to markdown rather than to assessment, so a typo cannot quietly create a
// document nobody can score.
check('an unknown type is not an assessment', isAssessment({ id: 'x', doc_type: 'assessmentx' }), false);

// THE SCORE IS A STRING. These are the reason the field is not a number: a time, a fraction and a word all have to
// survive a round trip unchanged, and any numeric coercion anywhere would quietly mangle two of them.
const scoreRow = { id: 'a1_u2', document_id: 'a1', user_id: 'u2', score: '4:52', scored_on: '2026-10-06' };
check('a time stays a time', normalizeAssessmentScore(scoreRow).score, '4:52');
check('a fraction is not turned into a number', normalizeAssessmentScore({ score: '12/15' }).score, '12/15');
check('a pass/fail word is kept', normalizeAssessmentScore({ score: 'Pass' }).score, 'Pass');
check('a mark out of ten keeps its denominator', normalizeAssessmentScore({ score: '8/10' }).score, '8/10');

// The id carries BOTH the assessment and the member, and that is load-bearing twice over: the rules can prove whose row
// a single-document get is about, and a re-score replaces rather than accumulates.
check('the row id carries the assessment and the member', assessmentScoreId('a1', 'u2'), 'a1_u2');
check('and is the same id for the same pair', assessmentScoreId('a1', 'u2') === assessmentScoreId('a1', 'u2'), true);
check('but a different id for another member', assessmentScoreId('a1', 'u2') === assessmentScoreId('a1', 'u3'), false);

// The date is the DAY the score was taken, and it is read through the app's own date parser rather than kept raw.
check('the date is read as a day key', normalizeAssessmentScore({ scored_on: '2026-10-06' }).scored_on, '2026-10-06');
check('and an unusable date is no date', normalizeAssessmentScore({ scored_on: 'sometime' }).scored_on, '');
check('the label says when it was scored', assessmentScoreDateLabel(scoreRow), 'Scored 2026-10-06');
check('and says nothing when there is no date', assessmentScoreDateLabel({ scored_on: '' }), '');

// AN EMPTY SCORE IS REFUSED, and this is not pedantry: a blank row and a member who has never been scored would look
// identical on the panel, which is exactly the ambiguity the feature exists to remove.
check('an empty score is refused', assessmentScoreProblem(''), 'Enter a score.');
check('whitespace is the same as empty', assessmentScoreProblem('   '), 'Enter a score.');
check('any text is accepted', assessmentScoreProblem('Pass'), '');
check('a number is accepted as the text it is', assessmentScoreProblem('42'), '');
check('an over-long score is refused', assessmentScoreProblem('x'.repeat(assessmentScoreLimit + 1)).length > 0, true);
check('a score exactly on the limit is fine', assessmentScoreProblem('x'.repeat(assessmentScoreLimit)), '');

// The per-member lookup. The panel shows ONE member at a time and this is what keeps it to one: asking for somebody
// else's score must not fall back to the first row in the list.
const scoreRows = [
  { id: 'a1_u1', document_id: 'a1', user_id: 'u1', score: 'Pass' },
  { id: 'a1_u2', document_id: 'a1', user_id: 'u2', score: '4:52' },
  { id: 'a2_u2', document_id: 'a2', user_id: 'u2', score: 'Slow' },
];
check('it finds that member on that assessment', memberAssessmentScore(scoreRows, 'a1', 'u2')?.score, '4:52');
check('and a different member gets their own', memberAssessmentScore(scoreRows, 'a1', 'u1')?.score, 'Pass');
check('the assessment is part of the key', memberAssessmentScore(scoreRows, 'a2', 'u2')?.score, 'Slow');
check('a member with no score is null, not the first row', memberAssessmentScore(scoreRows, 'a1', 'u9'), null);
check('and a blank member id is null', memberAssessmentScore(scoreRows, 'a1', ''), null);

// THE PERMISSION. A member permission rather than an administration one - the Documents module is not an Administration
// tab - and it rests on "View documents", which is what that module itself needs.
console.log('\n--- the permission that may write a score ---');
const scorePermission = MEMBER_PERMISSIONS.find((permission) => permission.key === 'can_add_assessment_scores');
checkIs('the permission exists', Boolean(scorePermission));
check('and is not an administration tab', scorePermission?.tab, undefined);
check('its label is the one the role table shows', scorePermission?.label, 'Add assessment scores');
check('it requires View documents', scorePermission?.requires, 'can_view_documents');
// Holding the score permission opens no Administration tab of its own - which is the point of making it a member
// permission rather than an administrative one.
check(
  'and it opens no Administration tab by itself',
  allowedAdminTabs({ can_add_assessment_scores: true }),
  []
);

// THE RULES ARE THE AUTHORITY. These three assert the client is not asked to be the thing that decides: the screen hides
// the control, and the rules refuse the write. Neither on its own. The emulator proof is in verify-rules.mjs.
console.log('\n--- and the rules are what refuse ---');
checkIs('the collection has rules of its own', /match \/document_assessment_scores/.test(rulesSource));
checkIs(
  'the only branch that writes one requires the permission',
  /allow create, update: if signedIn\(\)\s*&&\s*permission\('can_add_assessment_scores'\)/.test(rulesSource)
);
checkIs(
  'a member reads their own',
  /allow read: if signedIn\(\)\s*&&\s*\(resource\.data\.user_id == uid\(\)/.test(rulesSource)
);
// THE REQUIREMENT'S HARD PART, asserted as text: there is no branch anywhere in the write that lets the caller write
// their OWN score, and the rule actively forbids it.
checkIs(
  'and a member is refused their own, by name',
  /request\.resource\.data\.get\('user_id', ''\) != uid\(\)/.test(rulesSource),
  'the rules do not refuse a self-scored write'
);

// The panel needs an OPEN assessment, and SSR renders the INITIAL state - nothing opened, nothing loaded - so this
// asserts the two things that are true on that first render, and the wiring for the rest. Rendering the open state would
// mean standing the whole module up with a fetcher, which is what the read and write harnesses are for.
console.log('\n--- and the reader is never offered a way to change their own score ---');
// `moduleSource` is already read earlier in this file (line 918), so it is reused rather than redeclared, and this slice
// gets its own name because `panelSource` is already the AdminPanel's source further up. Two `const`s of one name are a
// build error - which is how both of those mistakes were found.
const scorePanelSource = moduleSource.slice(
  moduleSource.indexOf('function AssessmentScorePanel'),
  moduleSource.indexOf('export default function DocumentsModule')
);
// ONE CARD, THREE STATES - and the member it is about is chosen by the module's "View as" dropdown, NOT by a picker in
// here. These checks hold that: the card has no member picker at all, and what it renders is decided by which of the two
// questions is true.
//
//   "Myself"                     -> their own score, read-only
//   somebody else, no permission -> that member's score, read-only
//   somebody else, permission    -> that member's score, and the form to replace it
//
// The picker this card used to carry was a second control for a choice the module's header already made, and two controls
// for one choice is how they disagree - which is the same failure that hid the header's own "View as" dropdown.
checkIs(
  'the assessment card holds no member picker of its own',
  !/<select/.test(scorePanelSource) && !/pickMember/.test(scorePanelSource) && !/Choose a member/.test(scorePanelSource),
  'the card still carries a member dropdown'
);
// ...and it is told WHICH member it is showing, by name, so a score on screen is never anonymous.
checkIs(
  'it names the member being shown',
  /viewedMember \? `\$\{viewedMember\.label\}'s score` : 'Your score'/.test(scorePanelSource)
);
// "Myself": the reader's own score, read-only, with the reason stated rather than implied by an absent box.
checkIs('on Myself it shows the reader their own score', /\{!viewedMember && \(/.test(scorePanelSource));
checkIs(
  'and says they cannot change it, even their own',
  /cannot change it &mdash; not even your own/.test(scorePanelSource)
);
// Another member WITHOUT the permission: readable, and it says the form is absent on purpose.
checkIs(
  'on another member without the permission it is read-only',
  /\{viewedMember && !canAddScores && \(/.test(scorePanelSource) &&
    /Changing it needs the &ldquo;Add assessment scores&rdquo; permission/.test(scorePanelSource)
);
// Another member WITH the permission: the only place a score is written.
const formGuardAt = scorePanelSource.indexOf('{viewedMember && canAddScores && (');
const inputAt = scorePanelSource.indexOf('type="text"');
checkIs(
  'and the form appears only for another member WITH the permission',
  formGuardAt > -1 && inputAt > formGuardAt,
  'the score input is outside the "another member + may add scores" guard'
);
// The module does the looking up, keyed on the one navigator, rather than the card doing it for a member it chose.
checkIs(
  'the module reads the viewed member\'s score, keyed on the viewed member',
  /const memberId = viewAsMember\.id;[\s\S]*?fetchMemberAssessmentScore\(openDocumentId, memberId, token\)/.test(moduleSource),
  'the score read is not driven by the viewed member'
);
// ...and it may only ever DRAW a row that belongs to the member being viewed. That comparison is the whole reason there is
// no clearing pass: switching "View as" cannot leave the previous member's score on screen, because their row simply stops
// matching the moment the selection moves.
checkIs(
  'and a score is only drawn when the row belongs to the member being viewed',
  /const scoreBelongsToViewed = Boolean\(viewAsMember\) && scoreRead\?\.user_id === viewAsMember\?\.id;/.test(moduleSource)
);
checkIs(
  'and the View as dropdown is offered to either permission',
  /const canSelectMember = canVerify \|\| canAddScores;/.test(moduleSource) &&
    /\{canSelectMember && viewableMembers\.length > 0 && \(/.test(moduleSource),
  'an assessor cannot reach the navigator the card follows'
);
// The records read behind the same control is the verifier's, and an assessor is refused it by the rules - so it is gated
// on the permission that actually grants it, rather than on "somebody is selected".
checkIs(
  'the other member\'s document list is still gated on the verification permission',
  /if \(!viewingSomeoneElse \|\| !canVerify\) \{/.test(moduleSource),
  'an assessor without verification would be refused the records read across the whole pane'
);
// The reader's half has no input of any kind, and the explanation is stated rather than merely implied by an absence.
checkIs(
  'a member without the permission is told they cannot change their own',
  /cannot change it &mdash; not even your own/.test(scorePanelSource)
);
checkIs(
  'and is shown their score when there is one',
  // One read for both members now: `shown` is whichever score is on screen, so the reader's own and a viewed member's
  // are drawn by the same block rather than two copies that could drift apart.
  /const shown = viewedMember \? viewedScore : myScore;/.test(scorePanelSource) && /\{shown\.score\}/.test(scorePanelSource)
);
checkIs(
  'and told plainly when there is not',
  /No score has been recorded for you yet/.test(scorePanelSource)
);
// The navigator leaves the reader out - it is the MODULE's "View as" now, so this is asserted there rather than in the card.
// Without it the reader could select themselves and be offered a score form that the rules always refuse.
checkIs(
  'the View as dropdown leaves the reader out',
  /\.filter\(\(user\) => String\(user\.id\) !== String\(userId\)/.test(moduleSource),
  'the reader is listed in their own View as dropdown'
);
// The score is a TEXT input: `type="number"` would refuse "4:52" and "12/15", which is most of what a station records.
checkIs('the score field is text, not a number', /type="text"[\s\S]{0,400}?Score/.test(scorePanelSource));
checkIs('and it is capped at the length the server enforces', /maxLength=\{assessmentScoreLimit\}/.test(scorePanelSource));
// The panel is drawn for an assessment only, and the reader's score comes from the document read rather than a second one.
checkIs(
  'the panel is drawn only for an assessment',
  /\{documentIsAssessment && \([\s\S]*?<AssessmentScorePanel/.test(moduleSource)
);
checkIs(
  'and the reader score arrives with the document',
  /setMyScore\(result\.assessment_score \? normalizeAssessmentScore/.test(moduleSource)
);

// ---------------------------------------------------------------------------
// Back-filling the paper files: the screen, and the write behind it
// ---------------------------------------------------------------------------
console.log('\n--- the back-fill panel ---');
const backfillSource = readFileSync(path.resolve(process.cwd(), 'src/components/admin/AdminSignatureBackfill.jsx'), 'utf8');
const writesSource = readFileSync(path.resolve(process.cwd(), 'src/services/firestoreWrites.js'), 'utf8');
const rulesSource2 = readFileSync('firestore.rules', 'utf8');

// THE RULE THAT MAKES THE FEATURE SAFE. An officer may write a 'member' row for somebody else - that is what
// grandfathering needs - and ONLY while saying it was not the member's own tap. Pinned at the source as well as in the
// emulator, because this one clause is the difference between a back-fill and a forged signature.
checkIs(
  'the rules let an officer write a member row only when it is flagged as a back-fill',
  /permission\('can_manage_documents'\)[\s\S]{0,320}request\.resource\.data\.get\('backfilled', false\) == true/.test(rulesSource2) &&
    /request\.resource\.data\.get\('user_id', ''\) != uid\(\)/.test(rulesSource2),
  'an officer could write an ordinary signature in a member\u2019s name'
);
checkIs(
  'and the recorder is required to be the caller',
  /get\('signed_by_user_id', ''\) == uid\(\)/.test(rulesSource2),
  'a row could be attributed to somebody who did not enter it'
);

// The write: one action, honest rows, and no invention.
checkIs(
  'the writer refuses a record against the recorder themselves',
  /member === recorder[\s\S]{0,300}A back-fill is somebody else recording what they found/.test(writesSource),
  'a member could self-enter and make "I did this" and "the station recorded this" the same statement'
);
checkIs(
  'and works the rows out with the client\u2019s own helper rather than a second copy of the rule',
  /backfillSignaturePlan\(\{/.test(writesSource) && /import \{[\s\S]{0,200}backfillSignaturePlan/.test(writesSource),
  'the screen\u2019s count and the rows written could disagree'
);
checkIs(
  'a checklist\u2019s items come from the document, not from the request',
  /isChecklist \? await rowsFor\('document_checklist_items', 'document_id', document\) : \[\]/.test(writesSource),
  'a stale screen could point a row at another checklist\u2019s item'
);
checkIs(
  'and a plain document gets the whole-document row instead',
  /itemIds: isChecklist \? itemIds : \[WHOLE_DOCUMENT_ITEM\]/.test(writesSource),
  'a non-checklist would be given item rows that point at nothing'
);
checkIs(
  'the date the officer gave is used, and anything else falls back to now',
  /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(onDay\) \? onDay : stationTimestamp\(\)/.test(writesSource),
  'a back-filled row could be stamped with a date nobody gave'
);
checkIs(
  'and it is written in chunks, because a matrix can exceed one batch',
  /BACKFILL_CHUNK = \d+/.test(writesSource) && /start \+= BACKFILL_CHUNK/.test(writesSource),
  'a large back-fill would fail as one oversized batch'
);
checkIs(
  'member rows first, so a verification can never precede the signature it confirms',
  /\[\.\.\.plan\.member, \.\.\.plan\.verifier\]/.test(writesSource),
  'a chunk boundary could leave a confirmation of a row that is not there yet'
);
// THE READS GO TO THE SERVER, NOT THE CACHE. This is a CHOICE rather than a claim the harness can fail on, and it is
// written down as such: both reads follow a write (one decides what a second back-fill skips, the other is what the
// panel redraws from), and a cache-first read can hand back pre-write rows - the failure this whole area of the app has
// already had twice, where the save works and the screen says nothing happened. Proving it would need a harness that can
// control the local cache; what is pinned here is that the choice cannot be silently reverted.
checkIs(
  'the writer reads signatures from the server rather than the cache',
  /rowsOf\(query\(collection\(firestore\(\), 'document_signatures'\), where\('document_id', '==', document\)\), \{\s*source: 'server',/.test(
    writesSource
  ),
  'a pre-write cache answer would make the grid redraw as unrecorded, or let a duplicate row through'
);

// The panel: the flow the officer actually works in.
checkIs(
  'the panel is offered only where the write would be allowed',
  /canManageDocuments && \([\s\S]{0,200}<AdminSignatureBackfill/.test(tabSource),
  'a role without the permission would be offered a save the server refuses'
);
checkIs(
  'the recorder cannot pick themselves as the member',
  /backfillCandidates\(users, currentUserId\)/.test(backfillSource),
  'the member list would offer a save that always fails'
);
// THE MEMBER LIST IS THE ONE CONTROL THE PANEL HAS, so it has to actually ARRIVE. It is handed down two hops - the tab
// passes `users` on to the panel, and the panel turns it into options with `userLabel` - and the list it comes from is
// the crew directory, which is read per TAB (see sectionsForTab in App.jsx and NAME_DRAWING_TABS in
// verify-read-budget). Each hop is asserted because each has failed: the Documents tab had no directory entry at all,
// so the dropdown rendered empty and the screen looked complete, which is how it was reported.
checkIs(
  'the tab hands the panel the member rows it names from',
  /<AdminSignatureBackfill[\s\S]{0,300}users=\{users\}/.test(tabSource),
  'the panel would have nothing to list'
);
checkIs(
  'and the options are labelled by the shared helper rather than a raw field',
  /userLabel\(user\)/.test(backfillSource),
  'a half-filled row would read differently here than on every other screen'
);
checkIs(
  'with an empty list said out loud, so a silent dropdown is not the only symptom',
  /No members to record for/.test(backfillSource),
  'the officer would be left looking at a blank select with nothing to explain it'
);
// ...AND WHICH DOCUMENTS MAY BE BACK-FILLED IS READ THE SAME WAY AS EVERYWHERE ELSE. The raw `=== true` this first made
// is true of a row this app saved and false of the same row written by the sheet, whose cell is 'TRUE' - so a migrated
// document would be missing from the list while the server would have accepted the record for it. The string form is
// asserted against the helper directly, because that is the shape the disagreement appears in.
checkIs(
  'and a document is offered by the shared reading of the flag, not a raw one',
  /normalized\.is_sign_required/.test(backfillSource) && /normalizeDocument\(row\)/.test(backfillSource),
  "a row whose cell is 'TRUE' - which is what a migrated one holds - would be missing from the list"
);
check('the tolerant reading is what the module actually does', normalizeDocument({ is_sign_required: 'TRUE' }).is_sign_required, true);
check('and a plain false is still false', normalizeDocument({ is_sign_required: false }).is_sign_required, false);

// RENDERED, which is the claim the report was really about: "I can't select any members from the dropdown list". The
// source checks above say the prop is passed and the flag is read the shared way; this says the MEMBERS ARE ON THE
// SCREEN - options drawn, in the order the picker sorts them - and that the empty case explains itself rather than
// being a blank control. Both halves, because a panel that renders names proves nothing about the one that does not.
const backfillDoc = {
  id: 'cl1',
  title: 'Weekly Apparatus Check',
  folder: 'Engine',
  doc_type: 'checklist',
  is_sign_required: true,
};
// THREE MEMBERS, ONE OF THEM THE RECORDER: two have to be offered and the third must not be, so this render proves the
// list is populated AND that "a back-fill is somebody else's record" is still the rule - which is the one thing a
// populated list could silently lose.
const backfillHtml = renderToString(
  React.createElement(AdminSignatureBackfill, {
    token: 't1',
    documents: [backfillDoc],
    users: [
      { id: 'u2', name: 'Ana Ruiz' },
      { id: 'u1', name: 'Zed Quarles' },
      { id: 'u3', name: 'Bo Tran' },
    ],
    currentUserId: 'u1',
  })
);
checkIs('the broadest case: the member list is not empty', !/No members to record for/.test(backfillHtml), 'the panel reported an empty list');
[['a member', 'Ana Ruiz'], ['the other', 'Bo Tran'], ['the checklist', 'Weekly Apparatus Check']].forEach(([what, label]) => {
  checkIs(`and ${what} is an option`, backfillHtml.includes(label), `${label} is missing from the rendered panel`);
});
checkIs(
  'while the recording officer is not, because a back-fill is somebody else',
  !backfillHtml.includes('Zed Quarles'),
  'the officer could pick themselves, which the writer always refuses'
);
checkIs(
  'sorted, so the picker reads alphabetically',
  backfillHtml.indexOf('Ana Ruiz') < backfillHtml.indexOf('Bo Tran'),
  'the options would be in whatever order the directory arrived in'
);
// THE REPORTED SYMPTOM, as a rendered case: with no rows to name, the dropdown must SAY so. The document still has to
// be there, or the panel would be explaining an empty list it never drew.
const backfillEmptyHtml = renderToString(
  React.createElement(AdminSignatureBackfill, { token: 't1', documents: [backfillDoc], users: [], currentUserId: 'u1' })
);
checkIs('with nobody to record for, the panel says so', /No members to record for/.test(backfillEmptyHtml), 'a blank dropdown and no explanation');
checkIs(
  'Save & next member moves down the list, which is what makes a stack of files one pass',
  /if \(advance\) \{[\s\S]{0,700}const at = members\.findIndex[\s\S]{0,200}chooseMember\(String\(next\.id\)\)/.test(backfillSource),
  'an officer would have to re-pick the checklist and the member for each file'
);
checkIs(
  'the date and the note survive that move, because they belong to the sitting',
  /recordedOn,?\s*\n?\s*note/.test(backfillSource) && !/setRecordedOn\(todayKey/.test(backfillSource.split('advance: true')[1] || ''),
  'the date would be reset for every member in the pile'
);
checkIs(
  'an item already on file is not clickable and says which kind of done it is',
  /disabled=\{already\}/.test(backfillSource) && /state\.signedByMember/.test(backfillSource) && /'Recorded'/.test(backfillSource),
  'the officer could not tell a member\u2019s own tick from a row entered from paper'
);
checkIs(
  'the sections keep their own all/none, so a whole section is one click',
  /onAllFor\(groupIds, !groupAll\)/.test(backfillSource) && /Select everything left/.test(backfillSource),
  'a forty-item checklist would be forty clicks'
);
checkIs(
  'and the confirmation is a visible choice rather than an implied one',
  /Also confirm these as/.test(backfillSource) && /confirmVerified/.test(backfillSource),
  'an officer could not tell whether their entry also confirmed the item'
);
checkIs(
  'what the button says it will save is the same list the writer is given',
  /pending\.length\} item/.test(backfillSource) && /itemIds: isChecklist \? pending : \[WHOLE_DOCUMENT_ITEM\]/.test(backfillSource),
  'the count on the button and the rows written could drift apart'
);

console.log('\n--- what the minimum-rank repair decides to write ---');
// `correctedAudienceKeys` answers `null` for "leave it alone", and a `null` must be COMPARABLE, not fatal. The first
// version of this section called `.sort()` straight on the result, so the mutation it exists to catch (a repair that
// decides to write nothing) crashed the harness with a TypeError instead of reporting a named FAIL - a guard that fails
// loudly in the wrong way reads as a broken test, not as a caught regression. This maps both sides to the same shape.
const sorted = (value) => (value === null || value === undefined ? value : [...value].sort());

const LADDER = [
  { id: 'k1', rank_order: 3 },
  { id: 'k2', rank_order: 1 },
];

// THE BROKEN SHAPE, which is what every document saved before the fix looks like: a minimum rank, and a list holding one
// rank rather than every rank at or above it.
check(
  'the repair widens a document stored with one rank to every rank above its minimum',
  sorted(correctedAudienceKeys({ rank_id: 'k2', audience_keys: ['rank:k1'] }, LADDER)),
  ['rank:k1', 'rank:k2']
);

// THE CASE THAT MUST NOT BE "REPAIRED", and it is most of a real station: a minimum at the TOP of the ladder expands to
// that one rank, which is exactly what the old code stored. Rewriting those would touch every document to change nothing -
// and it is the reason the decision is null rather than an equal list.
check('a document already holding the right list is left alone', correctedAudienceKeys({ rank_id: 'k1', audience_keys: ['rank:k1'] }, LADDER), null);

// ORDER IS NOT AUDIENCE. The expansion reads the ranks collection in whatever order it returns, so a list holding the
// same ranks in another order is the same audience and must not be rewritten.
check(
  'and a list holding the same ranks in another order counts as right',
  correctedAudienceKeys({ rank_id: 'k2', audience_keys: ['rank:k2', 'rank:k1'] }, LADDER),
  null
);

// THE NON-RANK AUDIENCES, which this script has no business touching. Widening a role or a personal audience would show a
// document to people it was never aimed at, and that is the one failure a repair script must not be able to cause.
check('a document aimed at a role is left alone', correctedAudienceKeys({ role_id: 'r1', audience_keys: ['role:r1'] }, LADDER), null);
check('a document aimed at one member is left alone', correctedAudienceKeys({ user_id: 'u1', audience_keys: ['user:u1'] }, LADDER), null);
check('and a document aimed at everybody is left alone', correctedAudienceKeys({ audience_keys: ['*'] }, LADDER), null);

// A MINIMUM THAT IS NOT ON THE LADDER. `audienceKeysForWrite` refuses it, and the script passes that refusal through as
// "leave it alone" rather than widening the document to every rank - which is what treating an unknown minimum as zero
// would do.
check('a minimum rank that is not on the ladder is left alone, not widened to everyone', correctedAudienceKeys({ rank_id: 'gone', audience_keys: ['rank:gone'] }, LADDER), null);

// AND THE ROW THAT CANNOT BE JUDGED AT ALL, named separately because it is the one a station is most likely to have: a
// rank in the audience with no minimum recorded, which the script cannot expand without guessing.
check('a rank audience with no minimum rank recorded is reported rather than repaired', isUnjudgeable({ audience_keys: ['rank:k1'] }), true);
check('while a row with a minimum rank is never unjudgeable', isUnjudgeable({ rank_id: 'k1', audience_keys: ['rank:k1'] }), false);
check('and neither is one aimed at everybody', isUnjudgeable({ audience_keys: ['*'] }), false);

// A DOCUMENT WITH NO LIST AT ALL IS NOT THIS SCRIPT'S BUSINESS, and the distinction is the point of the case. Such a
// document is invisible to everybody, which is a different fault from the one being repaired, and "fixing" it here would
// mean inventing an audience nobody chose.
check('a document with no stored audience is left alone rather than given one', correctedAudienceKeys({ rank_id: 'k2' }, LADDER), null);

// THE NO-DRIFT CLAIM, asserted rather than believed. The script imports the app's own expansion, so the two cannot differ
// by accident - but only as long as it KEEPS importing it, and a future edit that pastes a copy in would leave every check
// above still passing while the script quietly grew its own definition of "a rank and above".
checkIs(
  'the repair script imports the app expansion rather than restating it',
  /import \{ audienceKeysForWrite \} from '\.\.\/src\/services\/firestoreWrites\.js'/.test(
    readFileSync('scripts/normalize-document-audience.mjs', 'utf8')
  ),
  'the script no longer uses the app function, so it can drift from it'
);
check(
  'and it agrees with the app on a widened document',
  sorted(correctedAudienceKeys({ rank_id: 'k2', audience_keys: ['rank:k1'] }, LADDER)),
  sorted(audienceKeysForWrite({ rankId: 'k2', ranks: LADDER, rankAndAbove: true }))
);

// SAFE TO RUN TWICE, which is what makes it a check as well as a fix: the second pass must find nothing to do, because
// the first pass wrote what it would want to write.
const once = correctedAudienceKeys({ rank_id: 'k2', audience_keys: ['rank:k1'] }, LADDER);
check(
  'and a second run over its own output finds nothing to do',
  once === null ? 'first pass wrongly declined to repair' : correctedAudienceKeys({ rank_id: 'k2', audience_keys: once }, LADDER),
  null
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

