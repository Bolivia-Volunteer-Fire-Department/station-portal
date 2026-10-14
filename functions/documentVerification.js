const text = (value) => String(value ?? '').trim();

const flag = (value) => value === true || text(value).toUpperCase() === 'TRUE';

const signatureRole = (signature) =>
  text(signature.signature_role).toLowerCase() === 'verifier' ? 'verifier' : 'member';

const pendingChecklistWorkCount = (document, items, signatures, verifierUserId) => {
  const docId = text(document.id);
  const itemIds = new Set(
    items
      .filter((item) => text(item.document_id) === docId)
      .map((item) => text(item.id))
      .filter(Boolean)
  );
  if (!itemIds.size) return 0;

  const documentSignatures = signatures.filter((signature) => text(signature.document_id) === docId);
  const verified = new Set(
    documentSignatures
      .filter((signature) => signatureRole(signature) === 'verifier')
      .map((signature) => `${text(signature.user_id)}\u0000${text(signature.checklist_item_id)}`)
  );

  const pendingPairs = new Set();
  documentSignatures.forEach((signature) => {
    if (signatureRole(signature) !== 'member') return;
    const userId = text(signature.user_id);
    const itemId = text(signature.checklist_item_id);
    if (userId && itemId && userId !== verifierUserId && itemIds.has(itemId) && !verified.has(`${userId}\u0000${itemId}`)) {
      pendingPairs.add(`${userId}\u0000${itemId}`);
    }
  });

  return pendingPairs.size;
};

const pendingDocumentWorkCount = (document, signatures, verifierUserId) => {
  if (!flag(document.is_sign_required) || !flag(document.requires_verification)) return 0;

  const docId = text(document.id);
  const documentSignatures = signatures.filter((signature) => text(signature.document_id) === docId);
  const verified = new Set(
    documentSignatures
      .filter((signature) => signatureRole(signature) === 'verifier' && !text(signature.checklist_item_id))
      .map((signature) => text(signature.user_id))
  );

  const pendingUsers = new Set();
  documentSignatures.forEach((signature) => {
    if (signatureRole(signature) !== 'member' || text(signature.checklist_item_id)) return;
    const userId = text(signature.user_id);
    if (userId && userId !== verifierUserId && !verified.has(userId)) {
      pendingUsers.add(userId);
    }
  });

  return pendingUsers.size;
};

const pendingDocumentVerificationsSummary = ({ documents = [], items = [], signatures = [], verifierUserId = '' } = {}) => {
  const verifier = text(verifierUserId);
  const byDocument = {};
  let total = 0;

  documents.forEach((document) => {
    const id = text(document.id);
    if (!id) return;
    const type = text(document.doc_type).toLowerCase();
    const count =
      type === 'checklist'
        ? pendingChecklistWorkCount({ ...document, id }, items, signatures, verifier)
        : pendingDocumentWorkCount({ ...document, id }, signatures, verifier);
    if (count > 0) {
      byDocument[id] = count;
      total += count;
    }
  });

  return {
    count: total,
    byDocument,
  };
};

const countPendingDocumentVerifications = (options = {}) => {
  return pendingDocumentVerificationsSummary(options).count;
};

module.exports = { countPendingDocumentVerifications, pendingDocumentVerificationsSummary };