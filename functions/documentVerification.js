const text = (value) => String(value ?? '').trim();

const flag = (value) => value === true || text(value).toUpperCase() === 'TRUE';

const signatureRole = (signature) =>
  text(signature.signature_role).toLowerCase() === 'verifier' ? 'verifier' : 'member';

const hasPendingChecklistWork = (document, items, signatures, verifierUserId) => {
  const itemIds = new Set(
    items
      .filter((item) => text(item.document_id) === document.id)
      .map((item) => text(item.id))
      .filter(Boolean)
  );
  if (!itemIds.size) return false;

  const documentSignatures = signatures.filter((signature) => text(signature.document_id) === document.id);
  const verified = new Set(
    documentSignatures
      .filter((signature) => signatureRole(signature) === 'verifier')
      .map((signature) => `${text(signature.user_id)}\u0000${text(signature.checklist_item_id)}`)
  );

  return documentSignatures.some((signature) => {
    if (signatureRole(signature) !== 'member') return false;
    const userId = text(signature.user_id);
    const itemId = text(signature.checklist_item_id);
    return userId !== verifierUserId && itemIds.has(itemId) && !verified.has(`${userId}\u0000${itemId}`);
  });
};

const hasPendingDocumentWork = (document, signatures, verifierUserId) => {
  if (!flag(document.is_sign_required) || !flag(document.requires_verification)) return false;

  const documentSignatures = signatures.filter((signature) => text(signature.document_id) === document.id);
  const verified = new Set(
    documentSignatures
      .filter((signature) => signatureRole(signature) === 'verifier' && !text(signature.checklist_item_id))
      .map((signature) => text(signature.user_id))
  );

  return documentSignatures.some((signature) => {
    if (signatureRole(signature) !== 'member' || text(signature.checklist_item_id)) return false;
    const userId = text(signature.user_id);
    return userId !== verifierUserId && !verified.has(userId);
  });
};

const countPendingDocumentVerifications = ({ documents = [], items = [], signatures = [], verifierUserId = '' } = {}) => {
  const verifier = text(verifierUserId);
  return documents.filter((document) => {
    const id = text(document.id);
    if (!id) return false;
    const type = text(document.doc_type).toLowerCase();
    return type === 'checklist'
      ? hasPendingChecklistWork({ ...document, id }, items, signatures, verifier)
      : hasPendingDocumentWork({ ...document, id }, signatures, verifier);
  }).length;
};

module.exports = { countPendingDocumentVerifications };