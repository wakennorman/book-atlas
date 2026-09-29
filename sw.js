/* 书脉 BookAtlas · Service Worker（离线可用） */
const CACHE = 'bookatlas-v78';
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
  './assets/logo-mark.svg',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './assets/favicon.ico',
  './assets/favicon-32x32.png',
  './editor.html',
  './css/editor.css',
  './js/editor.js',
  './editor.html?v=78',
  './css/editor.css?v=78',
  './js/editor.js?v=78',
  './css/style.css?v=78',
  './js/app.js?v=78',
  './js/export.js?v=78',
  './js/ai.js?v=78',
  './vendor/fflate.min.js?v=78',
  './vendor/pdf.min.js?v=78',
  './vendor/pdf.worker.min.js?v=78'
];

self.addEventListener('install', (e) => {
  // 容错预缓存：单个资源失败不阻塞整个安装
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(SHELL.map((url) => c.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
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

  // HTML/JS/CSS：网络优先，失败回退缓存
  // 保证部署后用户总能拿到最新版本，离线时用缓存兜底
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(req, clone));
        return res;
      }
      throw new Error('Network response not ok');
    }).catch(() =>
      caches.match(req).then((cached) => cached || caches.match('./index.html'))
    )
  );
});
