#!/usr/bin/env node
/**
 * Web E2E 冒烟测试（Node 内置能力，不需要浏览器）
 *
 * 启动本地 HTTP 服务，验证：
 *   · index.html 能加载
 *   · 数据文件能加载
 *   · 关键资源（CSS/JS/vendor）能加载
 *   · 编辑器页面能加载
 *
 * 用法：node test/e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18923;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

/* ---------------- 启动本地服务 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const fp = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(fp).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(res);
});

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: PORT, path: pathname }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

/* ---------------- 测试 ---------------- */
async function run() {
  await new Promise((r) => server.listen(PORT, r));
  console.log(`本地服务：http://localhost:${PORT}/\n`);

  section('首页加载');
  const index = await get('/');
  assert(index.status === 200, `index.html 返回 200（${index.status}）`);
  assert(index.body.includes('书脉'), '页面包含"书脉"');
  assert(index.body.includes('js/app.js'), '页面引用 js/app.js');
  assert(index.body.includes('css/style.css'), '页面引用 css/style.css');

  section('数据文件');
  const books = await get('/data/books.json');
  assert(books.status === 200, `books.json 返回 200（${books.status}）`);
  const booksData = JSON.parse(books.body);
  assert(booksData.books.length >= 3, `至少 3 本书（${booksData.books.length}）`);

  for (const b of booksData.books) {
    const fp = b.file.replace(/^data\//, '/data/');
    const res = await get(fp);
    assert(res.status === 200, `${b.title} 数据文件返回 200`);
  }

  section('静态资源');
  const css = await get('/css/style.css');
  assert(css.status === 200 && css.body.length > 1000, `style.css 加载（${css.body.length} 字节）`);

  const js = await get('/js/app.js');
  assert(js.status === 200 && js.body.length > 10000, `app.js 加载（${js.body.length} 字节）`);

  const echarts = await get('/vendor/echarts.min.js');
  assert(echarts.status === 200 && echarts.body.length > 100000, `echarts.min.js 加载（${echarts.body.length} 字节）`);

  section('编辑器页面');
  const editor = await get('/editor.html');
  assert(editor.status === 200, `editor.html 返回 200（${editor.status}）`);
  assert(editor.body.includes('js/editor.js'), '编辑器引用 js/editor.js');

  section('PWA 资源');
  const manifest = await get('/manifest.webmanifest');
  assert(manifest.status === 200, `manifest.webmanifest 返回 200（${manifest.status}）`);

  const sw = await get('/sw.js');
  assert(sw.status === 200 && sw.body.includes('bookatlas-v'), `sw.js 包含版本号`);

  section('404 处理');
  const notFound = await get('/nonexistent-page.html');
  assert(notFound.status === 404, `不存在的页面返回 404（${notFound.status}）`);

  server.close();

  console.log(`\n${'='.repeat(40)}`);
  console.log(`通过：${passed}  失败：${failed}`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('全部通过');
  }
}

function section(name) {
  console.log(`\n▶ ${name}`);
}

run().catch((e) => {
  console.error('测试失败：', e);
  server.close();
  process.exit(1);
});
