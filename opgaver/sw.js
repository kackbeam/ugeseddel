// Gør appen brugbar uden internet.
// Egne filer: henter altid nyeste version når der er net. Firebase-biblioteket og billeder gemmes lokalt.
const CACHE = 'opgaver-v1.0';
const FILES_CACHE = 'opgaver-filer';
const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'firebase-config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  SDK + 'firebase-app.js', SDK + 'firebase-auth.js', SDK + 'firebase-firestore.js', SDK + 'firebase-storage.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FILES_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimFiles() {
  const c = await caches.open(FILES_CACHE);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - 300; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
    );
    return;
  }

  if (req.url.startsWith(SDK)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    })));
    return;
  }

  // Billeder og filer fra Firebase Storage: vis gemt kopi, så de kan ses uden net.
  if (url.hostname === 'firebasestorage.googleapis.com' && url.searchParams.get('alt') === 'media') {
    e.respondWith(caches.open(FILES_CACHE).then((c) => c.match(req).then((r) => r || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { c.put(req, res.clone()).then(trimFiles); }
      return res;
    }))));
  }
});
