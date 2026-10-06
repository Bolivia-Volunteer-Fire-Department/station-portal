import verifier from '../functions/documentVerification.js';

const { countPendingDocumentVerifications } = verifier;
let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures++;
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${passed ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

const documents = [
  { id: 'checklist-pending', doc_type: 'checklist' },
  { id: 'checklist-complete', doc_type: 'checklist' },
  { id: 'checklist-own', doc_type: 'checklist' },
  { id: 'document-pending', doc_type: 'document', is_sign_required: true, requires_verification: true },
  { id: 'document-complete', doc_type: 'document', is_sign_required: true, requires_verification: true },
  { id: 'document-not-requested', doc_type: 'document', is_sign_required: true, requires_verification: false },
  { id: 'document-no-signature', doc_type: 'document', is_sign_required: true, requires_verification: true },
];
const items = [
  { id: 'item-a', document_id: 'checklist-pending' },
  { id: 'item-b', document_id: 'checklist-pending' },
  { id: 'item-c', document_id: 'checklist-complete' },
  { id: 'item-d', document_id: 'checklist-own' },
];
const signatures = [
  { id: 's1', document_id: 'checklist-pending', checklist_item_id: 'item-a', user_id: 'member-a', signature_role: 'member' },
  { id: 's2', document_id: 'checklist-pending', checklist_item_id: 'item-b', user_id: 'member-a', signature_role: 'member' },
  { id: 's3', document_id: 'checklist-pending', checklist_item_id: 'item-a', user_id: 'member-a', signature_role: 'verifier' },
  { id: 's4', document_id: 'checklist-complete', checklist_item_id: 'item-c', user_id: 'member-b', signature_role: 'member' },
  { id: 's5', document_id: 'checklist-complete', checklist_item_id: 'item-c', user_id: 'member-b', signature_role: 'verifier' },
  { id: 's6', document_id: 'checklist-own', checklist_item_id: 'item-d', user_id: 'verifier-a', signature_role: 'member' },
  { id: 's7', document_id: 'document-pending', checklist_item_id: '', user_id: 'member-c', signature_role: 'member' },
  { id: 's8', document_id: 'document-complete', checklist_item_id: '', user_id: 'member-d', signature_role: 'member' },
  { id: 's9', document_id: 'document-complete', checklist_item_id: '', user_id: 'member-d', signature_role: 'verifier' },
  { id: 's10', document_id: 'document-not-requested', checklist_item_id: '', user_id: 'member-e', signature_role: 'member' },
];

check(
  'counts unique documents with actionable checklist or document signatures',
  countPendingDocumentVerifications({ documents, items, signatures, verifierUserId: 'verifier-a' }),
  2
);
check(
  'excludes the current verifier’s own work',
  countPendingDocumentVerifications({
    documents: [documents[2]],
    items: [items[3]],
    signatures: [signatures[5]],
    verifierUserId: 'verifier-a',
  }),
  0
);
check(
  'an empty document list needs no verification',
  countPendingDocumentVerifications({ verifierUserId: 'verifier-a' }),
  0
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);