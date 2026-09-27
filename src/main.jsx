import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { lockGesturesWhenInstalled } from './utils/nativeShell.js'

// Before the first paint, so the window never lays out at one viewport and then changes its mind: an
// installed app gets pinch-zoom turned off, a browser tab keeps it (see utils/nativeShell.js).
lockGesturesWhenInstalled();

// Register the push-notification service worker up front so a device is ready
// the moment a member enables notifications in User Settings. Notification
// permission is requested there, from a click - never on page load.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL || '/';
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .catch((err) => console.warn('[push] Service worker registration failed:', err));
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
