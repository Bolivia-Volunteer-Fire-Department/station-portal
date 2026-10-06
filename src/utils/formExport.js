// The file a generated form is saved as, and the two ways to hand it over.
//
// The NAME is pure - a function of the form and the member - so a harness can pin it. That matters more than it sounds:
// a filename is what an officer searches their downloads for months later, so "which form, for whom, dated when" has to
// be in it rather than in the order the browser happened to list them.
//
// The two blob helpers are the same pattern utils/reportExport uses for a CSV download, so a form and a report behave
// identically and neither has to learn how the other does it.
const slug = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const formPdfFileName = ({ formName, subjectName, today } = {}) => {
  const parts = [slug(formName) || 'form', slug(subjectName)].filter(Boolean);
  const date = String(today || '').trim();
  return `${parts.join('-')}${date ? `-${date}` : ''}.pdf`;
};

const blobFor = (bytes) => new Blob([bytes], { type: 'application/pdf' });

// Opens the filled PDF in a new tab so it can be READ before it is saved - the browser's own viewer is where the print
// button already is. Returns the object URL so the caller can revoke it when the screen goes away.
export const openFormPdf = (bytes) => {
  const url = URL.createObjectURL(blobFor(bytes));
  window.open(url, '_blank', 'noopener');
  return url;
};

// Saves it under the name above, without leaving the screen.
export const downloadFormPdf = (bytes, fileName) => {
  const url = URL.createObjectURL(blobFor(bytes));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
