// Cache do app para funcionar offline. Mude a versão ao publicar mudanças.
const CACHE = 'menos-tela-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Responde do cache e atualiza em segundo plano.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const cached = await c.match(e.request);
    const fresh = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => cached);
    return cached || fresh;
  }));
});
