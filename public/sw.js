/* Station Portal service worker - push notifications only.
 *
 * Deliberately does NOT intercept fetches: the app is a Vite build with hashed
 * asset URLs, so an app-shell cache would have to be versioned on every deploy
 * to avoid serving stale bundles. Push delivery needs no fetch handler, so we
 * leave the network alone.
 *
 * The backend (Google Apps Script) sends data-only FCM messages, which arrive
 * here as a `push` event; this worker decides how they are displayed.
 */

// Bump to force browsers to pick up worker changes.
const SW_VERSION = 'station-portal-push-v5';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Data-only FCM payloads arrive as JSON in event.data.
function parsePushData(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

self.addEventListener('push', (event) => {
  const data = parsePushData(event);

  // FCM puts what Apps Script sent under `data` and adds its own `notification`
  // block alongside it. That block is NOT rendered for us: once a custom service
  // worker handles the push, only the showNotification() call below displays it
  // (with no call, Chrome falls back to a generic "site updated in the
  // background" notice rather than the real message). So always display here,
  // using the notification block only as a fallback source for title/body.
  const notification = data.notification || {};
  const payload = data.data || data;

  const title = notification.title || payload.title || 'Station Portal';
  const body = notification.body || payload.body || payload.message || 'You have a new update.';

  // One notification per event+offer, so separate shifts stack up instead of
  // silently replacing each other while repeat updates to one shift collapse.
  const tag = payload.tag ||
    (payload.event ? `${payload.event}:${payload.offer_id || ''}` : 'station-portal');

  const options = {
    body,
    // registration.scope is the deployed base path (e.g. https://host/station-portal/),
    // so these resolve correctly both locally and on GitHub Pages. The badge is a
    // transparent silhouette because Android tints it from the alpha channel.
    icon: self.registration.scope + 'icons/icon-192x192.png',
    badge: self.registration.scope + 'badge.png',
    tag,
    renotify: true,
    data: payload,
  };

  console.log('[sw] push received:', title, payload);

  event.waitUntil(
    (async () => {
      try {
        await self.registration.showNotification(title, options);
        console.log('[sw] notification displayed:', tag);
      } catch (err) {
        console.error('[sw] showNotification failed:', err);
      }

      // Hand the same message to any open app window so it can show an in-app
      // toast. The OS notification above is still shown: on systems that
      // suppress OS notifications (macOS without Chrome Helper alerts allowed)
      // the toast is the only thing the member sees.
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clientList.forEach((client) => {
        client.postMessage({ type: 'PUSH_RECEIVED', title, body, payload });
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = self.registration.scope;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an open tab when there is one.
        for (const client of clientList) {
          if ('focus' in client && client.url.startsWith(self.registration.scope)) {
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});

// Lets the page confirm which worker version is live.
self.addEventListener('message', (event) => {
  if (event.data === 'GET_SW_VERSION' && event.source) {
    event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION });
  }
});
