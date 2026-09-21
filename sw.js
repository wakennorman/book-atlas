/* 书脉 BookAtlas · Service Worker（离线可用） */
const CACHE = 'bookatlas-v25';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './vendor/echarts.min.js',
  './vendor/fflate.min.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './data/books.json',
  './data/one-hundred-years-of-solitude.json',
  './data/crime-and-punishment.json',
  './manifest.webmanifest',
  './assets/icon.svg',
  './editor.html',
  './css/editor.css',
  './js/editor.js',
  './editor.html?v=25',
  './css/editor.css?v=25',
  './js/editor.js?v=25',
  './css/style.css?v=25',
  './js/app.js?v=25',
  './css/style.css?v=25',
  './vendor/fflate.min.js?v=25',
  './vendor/pdf.min.js?v=25',
  './vendor/pdf.worker.min.js?v=25'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // 数据文件：stale-while-revalidate（先给缓存，后台更新）
  if (req.url.includes('/data/')) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => null);
        return cached || network;
      })
    );
    return;
  }

  // 其余：缓存优先，失败回退缓存
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).catch(() => caches.match('./index.html')))
  );
});
