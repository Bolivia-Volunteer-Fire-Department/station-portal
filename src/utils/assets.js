// URLs for files in public/.
//
// Files in public/ are copied to the build verbatim - Vite only rewrites the paths inside index.html -
// so a JSX string literal like "/logo.svg" resolves to the DOMAIN ROOT and 404s when the app is served
// from a subdirectory (https://<org>.github.io/<repo>/). import.meta.env.BASE_URL carries the configured
// base, so building the URL from it works at the root and in a subdirectory alike.
//
// The filename is also percent-encoded, because the department logo's filename contains spaces.

const publicUrl = (filename) => encodeURI(`${import.meta.env.BASE_URL}${filename}`);

// The department patch, shown on the login screen, in the sidebar and on printed schedules.
export const stationLogoUrl = () => publicUrl('Bolivia Fire Department Logo trans.svg');

// Exported for the verifier, so a new public asset gets the same treatment.
export const publicAssetUrl = publicUrl;
