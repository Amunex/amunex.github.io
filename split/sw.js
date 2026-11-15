/* Split: lets the app open with no signal. It only looks after this folder (/split/), nothing else on the site.
   The page and its files are fetched fresh whenever there's a connection; the saved copies are for when there isn't. */
const CACHE = 'split-v2';
const HOME = new URL('./', self.location).href;
const SHELL = ['./', 'style.css?v=2', 'app.js?v=2', 'core.js?v=2', 'store.js?v=2', 'rates.js?v=2', 'lib/qr.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png',
  'fonts/recursive-sans-casual-latin.woff2', 'fonts/recursive-mono-casual-latin.woff2'];
/* The Firebase library, same version as FB_VERSION in store.js. Saved up front so the app opens offline after one visit. */
const LIBRARY = ['app', 'auth', 'database'].map(n => `https://www.gstatic.com/firebasejs/12.19.0/firebase-${n}.js`);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all([c.addAll(SHELL), ...LIBRARY.map(u => c.add(u).catch(() => {}))])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('split-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function keep(key, res) { if (res && res.ok) { const c = await caches.open(CACHE); await c.put(key, res.clone()); } return res; }
/* Saved copy first (files that never change: fonts, the versioned Firebase library). */
async function savedFirst(req) {
  const hit = await caches.match(req);
  return hit || keep(req, await fetch(req));
}
/* Network first; the saved copy if there's no connection, or if the connection takes longer than three seconds.
   Files are matched by their full address, ?v= number included, so one version's page never gets another version's code. */
async function freshFirst(req, key) {
  const hit = await caches.match(key);
  const net = fetch(req).then(res => keep(key, res));
  if (!hit) return net;
  return Promise.race([net.catch(() => hit), new Promise(done => setTimeout(() => done(hit), 3000))]);
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mine = url.href.startsWith(HOME);
  const library = url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (!mine && !library) return;                              // exchange rates and the database go straight to the network
  if (library || url.pathname.endsWith('.woff2')) e.respondWith(savedFirst(req));
  else if (req.mode === 'navigate') e.respondWith(freshFirst(req, HOME));
  else e.respondWith(freshFirst(req, req.url));
});
