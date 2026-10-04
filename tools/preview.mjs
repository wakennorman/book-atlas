#!/usr/bin/env node
/**
 * 本地预览服务器（**日常看这个端口**）
 *
 *   node tools/preview.mjs            # http://127.0.0.1:8765/
 *   node tools/preview.mjs 8080       # 换端口
 *
 * ## 为什么需要它，而不是随手起一个 http.server
 *
 * 1. **绕开 Service Worker 的 cache-first 缓存。**
 *    这是"我改了代码但页面没变"的头号原因：sw.js 一旦注册成功，它会拦下所有请求、
 *    按自己的缓存键（`bookatlas-vNN`）返回旧文件，服务器明明是新的也没用。
 *    本项目已经吃过一次这个亏（v0.69–v0.71 为它专门写了 `scripts/check-version.mjs`）。
 *    ⇒ 这里对 `/sw.js` 返回**空壳 worker**（带 `Clear-Site-Data` 头，让浏览器注销旧 SW），
 *      并且**不注册**自己的 SW。
 * 2. **所有响应 `no-store`。** 避免浏览器自己的 HTTP 缓存也来添乱。
 * 3. **固定端口 + 明确的启动横幅。** 别再随手打开测试脚本起的临时端口
 *    ——`test/*.mjs` 里有 10 个写死端口（roam 是 19135、lock 19131、render-scale 19133…），
 *    那是**测试自己**用的，跑完就没了，服务的是"那一刻磁盘上的代码"。
 *    本文件才是该长期打开的地址。
 * 4. 页脚会显示构建版本号（v0.95 起）——对不上就说明还在跑旧缓存，
 *    按 Shift+Ctrl+R 硬刷新，或看横幅里的 SW 提示。
 *
 * 停止：Ctrl+C
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.BA_PREVIEW_PORT || 8765);

const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.epub': 'application/epub+zip',
  '.txt': 'text/plain;charset=utf-8', '.mjs': 'text/javascript;charset=utf-8',
  '.wasm': 'application/wasm', '.map': 'application/json;charset=utf-8',
};

const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/') rel = '/index.html';

  // 空壳 SW：清掉旧缓存并自我注销，这样页面之后不会再被 cache-first 拦
  if (rel === '/sw.js') {
    rep.writeHead(200, {
      'Content-Type': 'text/javascript;charset=utf-8',
      'Cache-Control': 'no-store',
      'Clear-Site-Data': '"cache"',
    });
    rep.end('// 预览服务器：故意不注册 Service Worker。\n'
      + '// 见 tools/preview.mjs 顶部说明（本地预览被旧缓存拦住是"改了没变"的头号原因）。\n'
      + 'self.addEventListener("install", () => self.skipWaiting());\n'
      + 'self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));\n');
    return;
  }

  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    rep.writeHead(404, { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-store' });
    rep.end('404 ' + rel);
    return;
  }
  rep.writeHead(200, {
    'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(fp).pipe(rep);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用 —— 很可能你已经开着预览服务器了，直接访问 http://127.0.0.1:${PORT}/`);
    console.error('（要换端口：node tools/preview.mjs 8080）');
    process.exit(1);
  }
  console.error('预览服务器起不来：' + e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const v = /const CACHE = 'bookatlas-v(\d+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8') || '');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  console.log('');
  console.log('  书脉 BookAtlas · 本地预览');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  地址        http://127.0.0.1:${PORT}/`);
  console.log(`  当前版本    v0.${v ? v[1] : '?'}（package ${pkg}）`);
  console.log('  缓存        已禁用（/sw.js 是空壳，会注销旧 Service Worker）');
  console.log('');
  console.log('  页面没变？  页脚会显示构建版本号；先按 Shift+Ctrl+R 硬刷新。');
  console.log('  停止        Ctrl+C');
  console.log('');
});