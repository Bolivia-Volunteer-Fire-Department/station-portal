import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { lockGesturesWhenInstalled } from './utils/nativeShell.js'
import { startPeriodicUpdateChecks } from './utils/versionCheck.js'

// When a new build is deployed, chunk hashes change on the hosting server. If an open tab
// tries to dynamically import a chunk that was replaced, Vite fires 'vite:preloadError'.
// Reloading fetches the latest index.html and its fresh chunk manifest.
try {
  sessionStorage.removeItem('vite_preload_retry');
} catch {
  // Ignore restricted storage environments
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    const hasRetried = sessionStorage.getItem('vite_preload_retry');
    if (!hasRetried) {
      sessionStorage.setItem('vite_preload_retry', 'true');
      window.location.reload();
      return;
    }
  } catch {
    window.location.reload();
    return;
  }
  console.error('[vite] Chunk preload failed after reload:', event?.payload);
});

// Before the first paint, so the window never lays out at one viewport and then changes its mind: an
// installed app gets pinch-zoom turned off, a browser tab keeps it (see utils/nativeShell.js, which also
// records why the status bar is NOT adjusted here).
lockGesturesWhenInstalled();

// Monitor for new releases when app is in use or resumed.
startPeriodicUpdateChecks();

// Register the push-notification service worker up front so a device is ready
// the moment a member enables notifications in User Settings. Notification
// permission is requested there, from a click - never on page load.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL || '/';
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .then((reg) => {
        reg?.update().catch(() => {});
      })
      .catch((err) => console.warn('[push] Service worker registration failed:', err));
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
