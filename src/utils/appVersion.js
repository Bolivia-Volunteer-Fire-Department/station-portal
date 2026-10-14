// Current application version and build timestamp.
export const APP_VERSION =
  (typeof import.meta !== 'undefined' && import.meta.env?.APP_VERSION) || '1.65';
export const APP_BUILD_TIME =
  (typeof import.meta !== 'undefined' && Number(import.meta.env?.APP_BUILD_TIME)) || 0;

