export const SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL;

// Fail loudly rather than mysteriously.
//
// Without this, a missing value reaches fetch() as the literal string "undefined" and the browser reports
// "Failed to parse URL from /undefined", which says nothing about the cause. The workflow refuses to build
// without the repository secret, so this only fires for a local checkout with no .env.
if (!SCRIPT_URL) {
  console.error(
    '[config] VITE_APPS_SCRIPT_URL is not set, so no backend call can succeed.\n' +
      '  Local:  copy .env.example to .env and paste your Apps Script /exec URL.\n' +
      '  Pages:  add it as a repository secret named VITE_APPS_SCRIPT_URL.'
  );
}