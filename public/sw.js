// AMYC PWA Service Worker - Offline-First Strategy v5
const CACHE_NAME = 'amyc-v6';
const STATIC_CACHE = 'amyc-static-v6';
const DYNAMIC_CACHE = 'amyc-dynamic-v6';
const OFFLINE_CACHE = 'amyc-offline-v6';

// Static assets to pre-cache during install
const STATIC_ASSETS = [
  '/',
  '/login',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  '/logo-amyc.jpeg',
];

// File extensions for cache-first strategy (static assets)
const STATIC_EXTENSIONS = [
  '.js', '.css', '.mjs',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.json', '.wasm',
];

// API/routes to skip (never cache)
const SKIP_PATTERNS = [
  '/api/',
  '/_next/data/',
  '/_next/image',
  'chrome-extension',
];

// Offline fallback page HTML
const OFFLINE_PAGE = `
<!DOCTYPE html>
<html lang="sw">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AMYC - Nje ya Mtandao</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f0fdf4; color: #065f46; }
    .container { text-align: center; padding: 2rem; max-width: 480px; }
    .icon { font-size: 4rem; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #047857; font-size: 0.95rem; line-height: 1.6; margin-bottom: 1.5rem; }
    button { background: #059669; color: white; border: none; padding: 0.75rem 2rem; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; }
    button:hover { background: #047857; }
    .version { margin-top: 1.5rem; font-size: 0.75rem; color: #6ee7b7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📡</div>
    <h1>AMYC Mfumo wa Fedha</h1>
    <p>Haupo kwenye mtandao kwa sasa. Unaweza kuendelea kutumia data iliyo hifadhiwa kwenye kifaa chako.</p>
    <button onclick="window.location.reload()">Jaribu Tena</button>
    <div class="version">AMYC Mfumo wa Fedha v2.1 &middot; 2026-2040</div>
  </div>
</body>
</html>
`;

// Install - pre-cache static assets + offline page
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        // Cache assets individually so one failure doesn't block the rest
        return Promise.allSettled(
          STATIC_ASSETS.map((url) =>
            cache.add(url).catch(() => {
              // Individual asset may fail in some environments - that's OK
            })
          )
        );
      })
      .then(() => caches.open(OFFLINE_CACHE))
      .then((cache) => cache.put('/offline', new Response(OFFLINE_PAGE, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })))
      .then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE && name !== OFFLINE_CACHE)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Check if URL is a static asset (by file extension)
function isStaticAsset(url) {
  try {
    const pathname = new URL(url).pathname;
    return STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

// Check if request should be skipped entirely (API, non-GET, etc.)
function shouldSkip(url) {
  try {
    const pathname = new URL(url).pathname;
    return SKIP_PATTERNS.some((pattern) => pathname.includes(pattern));
  } catch {
    return true;
  }
}

function isNextStaticAsset(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.startsWith('/_next/static/');
  } catch {
    return false;
  }
}

// Cache-first strategy: serve from cache, fall back to network
// Best for: JS, CSS, images, fonts (assets that don't change often)
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const responseClone = networkResponse.clone();
      caches.open(STATIC_CACHE).then((cache) => {
        cache.put(request, responseClone).catch(() => {});
      });
    }
    return networkResponse;
  } catch {
    return new Response('', {
      status: 503,
      statusText: 'Offline - Resource not cached',
    });
  }
}

// Stale-while-revalidate: serve from cache immediately, update cache in background
// Best for: HTML pages (fast load + fresh content on next visit)
async function staleWhileRevalidate(request) {
  const cachedResponse = await caches.match(request);

  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        const responseClone = networkResponse.clone();
        caches.open(DYNAMIC_CACHE).then((cache) => {
          cache.put(request, responseClone).catch(() => {});
        });
      }
      return networkResponse;
    })
    .catch(() => {
      // Network failed - if we also have no cache, show the offline fallback page
      if (!cachedResponse) {
        return caches.match('/offline').then((offlineResponse) => {
          return offlineResponse || caches.match('/');
        });
      }
      // This should not be reached since we return cachedResponse above,
      // but just in case
      return new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable',
      });
    });

  // Return cached version immediately if available, otherwise wait for network
  return cachedResponse || fetchPromise;
}

// Network-first with cache fallback
// Best for: dynamic content that should be fresh but still works offline
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const responseClone = networkResponse.clone();
      caches.open(DYNAMIC_CACHE).then((cache) => {
        cache.put(request, responseClone).catch(() => {});
      });
    }
    return networkResponse;
  } catch {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    // For navigation requests, show the offline fallback page
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match('/offline');
      if (offlinePage) return offlinePage;
    }
    return new Response('', {
      status: 503,
      statusText: 'Offline - Resource not cached',
    });
  }
}

// Fetch event - route to appropriate strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip non-http requests (chrome-extension, etc.)
  if (!request.url.startsWith('http')) return;

  // Skip API routes and other non-cacheable paths
  if (shouldSkip(request.url)) return;

  // Route to strategy based on request type
  if (isNextStaticAsset(request.url) || isStaticAsset(request.url)) {
    // Cache-first for static assets and Next chunks; critical for cold offline APK/PWA starts.
    event.respondWith(cacheFirst(request));
  } else if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    // Stale-while-revalidate for HTML navigation requests
    event.respondWith(staleWhileRevalidate(request));
  } else {
    // Network-first for other requests (with cache fallback)
    event.respondWith(networkFirst(request));
  }
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
