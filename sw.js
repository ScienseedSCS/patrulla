/* Service Worker · Patrulla Antimosquito
   index.html y config.js → RED PRIMERO (siempre la última versión si hay
     internet; caché sólo como respaldo sin conexión). Por eso NO hace falta
     subir la versión ni tocar este archivo cada vez que cambia el index.
   Resto de archivos (íconos, imágenes) → caché primero (carga rápida).
   Supabase (datos/fotos/auth) → siempre red, nunca se cachea.
*/
const VERSION = 'patrulla-v7';
const SHELL = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // No cachear Supabase (API/auth/storage).
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) return;

  // RED PRIMERO para el documento y la config: siempre lo último si hay conexión.
  const fresh = req.mode === 'navigate'
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('/index.html')
    || url.pathname.endsWith('/config.js');

  if (fresh) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // CACHÉ PRIMERO para el resto (íconos, imágenes), con actualización en segundo plano.
  event.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
