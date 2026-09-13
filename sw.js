// Inertia service worker — shell caching only.
// Never caches API or Supabase calls, so training data is always live.
const CACHE = 'inertia-v3';
const SHELL = [
  '/',
  '/index.html',
  '/app.html',
  '/offline.html',
  '/manifest.json',
  '/legal.js',
  '/styles/tokens.css',
  '/styles/app.css',
  '/styles/landing.css',
  '/styles/legal.css'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // One missing file must not fail the whole install, so each is added
      // on its own and a failure is tolerated.
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;          // always live
  if (url.hostname.includes('supabase.co')) return;      // always live
  if (url.hostname.includes('anthropic.com')) return;

  // network first, fall back to cache when offline
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(hit => {
          if (hit) return hit;
          // A navigation that missed the cache falls back to the right shell:
          // the app for app routes, the marketing page for everything else.
          if (e.request.mode === 'navigate') {
            const shell = url.pathname.startsWith('/app') ? '/app.html' : '/index.html';
            return caches.match(shell).then(s => s || caches.match('/offline.html'));
          }
          return undefined;
        })
      )
  );
});
