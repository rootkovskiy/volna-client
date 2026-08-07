const VERSION = 'volna-pwa-v11';
const STATIC_ASSETS = [
  '/manifest.json',
  '/pwa/apple-touch-icon.png',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/pwa/icon-maskable-512.png',
];

function createNetworkFailureResponse(request) {
  const acceptsHtml = request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');
  if (acceptsHtml) {
    return new Response(
      '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VOLNA недоступна</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px system-ui;background:#fff;color:#111}main{width:min(320px,calc(100% - 48px));text-align:center}h1{margin:0;font-size:22px}p{margin:10px 0 20px;color:#777;font-size:14px;line-height:20px}button{width:100%;border:0;border-radius:22px;padding:12px 16px;background:#111;color:#fff;font:600 14px system-ui;cursor:pointer}</style><main><h1>Нет соединения с VOLNA</h1><p>Если интернет работает, доступ к Cloudflare может быть ограничен. Попробуйте включить VPN и загрузить приложение снова.</p><button type="button" onclick="location.reload()">Попробовать снова</button></main>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
    );
  }

  return new Response(JSON.stringify({ statusCode: 503, message: 'VOLNA temporarily unavailable' }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function fetchOrFailure(request) {
  try {
    return await fetch(request);
  } catch {
    return createNetworkFailureResponse(request);
  }
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isApplicationBootstrapRequest(request, url) {
  return request.mode === 'navigate'
    || url.pathname.endsWith('.bundle')
    || url.pathname.includes('/expo-router/entry.bundle')
    || url.pathname.startsWith('/_expo/static/js/');
}

async function fetchBootstrapWithRetry(request) {
  try {
    return await fetch(request);
  } catch {
    // The tunnel can briefly reconnect while the app is opening. One bounded
    // retry prevents a transient EOF from leaving the installed PWA on its
    // static boot screen forever in either development or production mode.
    await wait(500);
    return fetchOrFailure(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { body: event.data?.text() || '' }; }
  const title = payload.title || 'VOLNA';
  const options = {
      body: payload.body || '',
      icon: payload.icon || '/pwa/icon-192.png',
      badge: payload.badge || '/pwa/icon-192.png',
      data: { url: payload.url || '/profile?section=notifications' },
  };
  if (payload.eventType) {
    options.tag = `volna-${payload.eventType}`;
    options.renotify = true;
  }
  const badgeCount = Number(payload.badgeCount);
  const updateBadge = Number.isFinite(badgeCount) && badgeCount > 0
    ? (typeof self.navigator?.setAppBadge === 'function' ? self.navigator.setAppBadge(badgeCount) : Promise.resolve())
    : (typeof self.navigator?.clearAppBadge === 'function' ? self.navigator.clearAppBadge() : Promise.resolve());
  const notifyOpenClients = self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => Promise.all(clients.map((client) => client.postMessage({ type: 'volna:notification', badgeCount }))));
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    updateBadge,
    notifyOpenClients,
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url || '/profile?section=notifications', self.location.origin);
  const targetUrl = requestedUrl.origin === self.location.origin
    ? requestedUrl.href
    : new URL('/profile?section=notifications', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const client = clients.find((item) => new URL(item.url).origin === self.location.origin);
    if (client) {
      await client.navigate(targetUrl);
      return client.focus();
    }
    return self.clients.openWindow(targetUrl);
  }));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetchOrFailure(request)));
    return;
  }

  // VOLNA is under active local development. Always request application,
  // API and user data from the computer behind the tunnel so an installed
  // PWA cannot keep showing an outdated authenticated screen.
  event.respondWith(
    isApplicationBootstrapRequest(request, url)
      ? fetchBootstrapWithRetry(request)
      : fetchOrFailure(request),
  );
});
