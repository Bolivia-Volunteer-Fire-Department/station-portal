// URLs for files in public/.
//
// Files in public/ are copied to the build verbatim - Vite only rewrites the paths inside index.html -
// so a JSX string literal like "/logo.svg" resolves to the DOMAIN ROOT and 404s when the app is served
// from a subdirectory (https://<org>.github.io/<repo>/). import.meta.env.BASE_URL carries the configured
// base, so building the URL from it works at the root and in a subdirectory alike.
//
// The filename is also percent-encoded, because the department logo's filename contains spaces.

const publicUrl = (filename) => encodeURI(`${import.meta.env.BASE_URL}${filename}`);

const defaultLogoFilename = () => {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const explicit = String(env.VITE_DEPARTMENT_LOGO || '').trim();
  if (explicit) return explicit;
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID || '').trim();
  if (projectId && projectId !== 'fire-clock-76723') {
    return 'StationSync_loops.svg';
  }
  return 'Bolivia Fire Department Logo trans.svg';
};

// The department patch, shown on the login screen, on the timeclock and on printed schedules.
export const stationLogoUrl = () => publicUrl(defaultLogoFilename());

// StationSync brand logos. SVG, so they stay sharp at any size: both are drawn to the SAME viewBox as the PNGs they
// replaced (2215x448 full lockup, 837x448 loops), so nothing on screen moves. The loops mark is also used as a CSS mask
// for the splash shimmer (SplashScreen -> --splash-logo), which is the other reason a vector helps.
export const stationSyncLoopsUrl = () => publicUrl('StationSync_loops.svg');
export const stationSyncOnTransUrl = () => publicUrl('StationSync_full.svg');

// Resolves the department logo: uses custom uploaded logo URL if configured, or falls back to the station shield.
export const departmentLogoUrl = (systemSettingsOrCustomUrl) => {
  if (typeof systemSettingsOrCustomUrl === 'string' && systemSettingsOrCustomUrl.trim()) {
    return systemSettingsOrCustomUrl.trim();
  }
  if (Array.isArray(systemSettingsOrCustomUrl)) {
    const row = systemSettingsOrCustomUrl.find((s) => String(s?.key ?? '').trim() === 'department_logo_url');
    if (row?.value && String(row.value).trim()) return String(row.value).trim();
  } else if (systemSettingsOrCustomUrl && typeof systemSettingsOrCustomUrl === 'object') {
    const val = systemSettingsOrCustomUrl.department_logo_url;
    if (val && String(val).trim()) return String(val).trim();
  }
  return stationLogoUrl();
};

// Exported for the verifier, so a new public asset gets the same treatment.
export const publicAssetUrl = publicUrl;

