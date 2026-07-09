const CACHE = 'patrulla-antimosquito-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.json',
  './logo_mosquito.png'
];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)))
);

self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
);

self.addEventListener('fetch', e => {
  // No cachear las llamadas a la API de Supabase (siempre datos frescos)
  if(e.request.url.includes('supabase')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
