const CACHE_NAME = 'uniclass-shell-v4';
const SHELL = ['/', '/index.html', '/manifest.json', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Stale-while-revalidate: the cached copy is returned immediately so repeat
  // loads stay instant, but the network response always replaces it.
  //
  // This used to be cache-first, which returned the cached copy and only wrote
  // the new response on a later visit. A deploy that changed the app therefore
  // served the previous version to anyone who had the old asset cached, and a
  // second reload was needed before the change appeared. Vite's dev module URLs
  // are not fingerprinted, so this was the reason a rebuilt page kept rendering
  // as the old one during development.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});

// ── device notifications ─────────────────────────────────────────────────
// The page posts a subscription here; it then receives notifications from the
// push edge function without the tab having to be open.

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SUBSCRIBE_PUSH' && data.subscription) {
    event.waitUntil(
      self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: data.subscription })
        .then(() => event.source && event.source.postMessage({ type: 'PUSH_SUBSCRIBED' }))
        .catch((error) => event.source && event.source.postMessage({ type: 'PUSH_SUBSCRIBE_FAILED', error: String(error) }))
    );
    return;
  }

  if (data.type === 'UNSUBSCRIBE_PUSH') {
    event.waitUntil(
      self.registration.pushManager.getSubscription()
        .then((subscription) => (subscription ? subscription.unsubscribe() : null))
        .then(() => event.source && event.source.postMessage({ type: 'PUSH_UNSUBSCRIBED' }))
    );
    return;
  }

  if (data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'UniClass', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'UniClass';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon.svg',
    badge: payload.badge || '/favicon.svg',
    tag: payload.tag || payload.kind || 'uniclass',
    renotify: false,
    data: { url: payload.url || payload.link || '/' },
  };

  if (payload.tag) options.tag = payload.tag;

  event.waitUntil(self.registration.showNotification(title, options));
});

// Opening a notification focuses an existing tab rather than piling up new ones.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })
  );
});