/* 书脉 BookAtlas · Service Worker（离线可用） */
const CACHE = 'bookatlas-v98';
// 只列页面真正会用到的 URL。
// v85：删掉了重复项 —— 之前 editor.html / css/editor.css / js/editor.js / css/style.css / js/app.js
// 各存了两份（一份无 ?v=、一份带 ?v=98），Cache Storage 的 key 不同 ⇒ app.js 白白占了两份 193KB。
// 页面里引用的是带 ?v= 的那份，这里就只留带 ?v= 的。
// 另：js/export.js、js/ai.js 已删除（逻辑并入 app.js），不再预缓存；
//     补上 data/three-kingdoms.json —— 之前唯独它不在预缓存里，首次离线访问拿不到三国。
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './assets/favicon.ico',
  './assets/favicon-32x32.png',
  './assets/logo-mark.svg',
  './editor.html',
  './css/style.css?v=98',
  './css/editor.css?v=98',
  './js/app.js?v=98',
  './js/editor.js?v=98',
  './vendor/echarts.min.js',
  './vendor/fflate.min.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './data/books.json',
  // v85：首屏只下图包（graphFile）。文案包（textFile）由页面在图渲染完后自己预取，
  // **不**进 SW 预缓存 —— 预缓存会在首次访问时就下载，等于把拆包省下的又还回去。
  './data/one-hundred-years-of-solitude.graph.json',
  './data/crime-and-punishment.graph.json',
  './data/three-kingdoms.graph.json',
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
