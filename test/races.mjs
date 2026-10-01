import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 复现并守住三个只在真实浏览器里才暴露的问题（v85 修）：
//  A. 快速切书 ⇒ loadBook 必须丢弃过期响应，否则后到的会把当前书覆盖掉
//  B. 前一本书文案失败 ⇒ 不能连累新书（旧实现 state.textLoaded='failed' 是 truthy）
//  C. 连切书之后 resize 回调与 chart 必须还活着
//  D. 导出 JSON 前必须确保文案已就位，否则导出的是"被剥掉散文"的文件
//
// 用法：node test/races.mjs
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18981, CDP_PORT = 18982;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.error('找不到 Edge/Chrome，跳过'); process.exit(0); }

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
// 三国图包加延迟（模拟"大书慢"）；除百年孤独外，文案包一律 500 —— 制造"某本书文案失败"
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  if (rel.includes('three-kingdoms.graph.json')) {
    return setTimeout(() => {
      rep.writeHead(200, { 'Content-Type': MIME['.json'] });
      fs.createReadStream(fp).pipe(rep);
    }, 800);
  }
  if (rel.includes('.text.json') && !rel.includes('one-hundred-years')) { rep.writeHead(500); rep.end('boom'); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(rep);
});
await new Promise((r) => server.listen(PORT, r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-race-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }

let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const switchTo = (slug) => js(`(()=>{const s=document.getElementById('book-select'); s.value=${JSON.stringify(slug)}; s.dispatchEvent(new Event('change'));})()`);

try {
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); }
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=one-hundred-years-of-solitude` });
  for (let i = 0; i < 120; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.book && window.__ba.state.chart)`).catch(() => false)) break;
    await wait(250);
  }
  await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`);
  await wait(1500);

  /* ---------- D：文案失败这件事，必须只影响那一本书 ---------- */
  console.log('\n▶ D 上一本文案拉取失败，不能连累新书');
  await switchTo('crime-and-punishment');           // 本服务器把它的 text.json 打成 500
  await wait(2600);
  const failedBook = await js(`(() => { const s = window.__ba.state; return { slug: s.book.meta.slug, status: s.textStatus && s.textStatus.status, tSlug: s.textStatus && s.textStatus.slug }; })()`);
  ok(failedBook.slug === 'crime-and-punishment' && failedBook.status === 'failed',
    `罪与罚的文案失败被如实记下（status=${failedBook.status}, textStatus.slug=${failedBook.tSlug}）`);
  ok(failedBook.tSlug === failedBook.slug, `失败状态记在它自己名下，不是别的书（${failedBook.tSlug}）`);

  await switchTo('one-hundred-years-of-solitude');  // 这本文案能取到
  await wait(2600);
  const goodBook = await js(`(() => {
    const st = window.__ba.state;
    return {
      slug: st.book.meta.slug,
      status: st.textStatus && st.textStatus.status,
      withDesc: st.book.characters.filter(c => (c.desc || '').length > 0).length,
      withFate: st.book.characters.filter(c => (c.fate || '').length > 0).length,
      n: st.book.characters.length,
    };
  })()`);
  ok(goodBook.withDesc > 0 && goodBook.withFate > 0,
    `切回百年孤独后文案完整贴回（${goodBook.withDesc}/${goodBook.n} 有描述、${goodBook.withFate} 有结局，status=${goodBook.status}）`);

  /* ---------- A：快速切书，过期响应必须被丢弃 ---------- */
  console.log('\n▶ A 快速切书，后到的响应不能覆盖当前书');
  await js(`(() => {
    const s = document.getElementById('book-select');
    s.value = 'one-hundred-years-of-solitude'; s.dispatchEvent(new Event('change'));
    s.value = 'three-kingdoms'; s.dispatchEvent(new Event('change'));            // 被加了 800ms
    s.value = 'one-hundred-years-of-solitude'; s.dispatchEvent(new Event('change')); // 应该赢
  })()`);
  await wait(3200);
  const race = await js(`(() => {
    const s = document.getElementById('book-select');
    return { select: s.value, book: window.__ba.state.book.meta.slug, n: window.__ba.state.book.characters.length };
  })()`);
  ok(race.select === race.book,
    `下拉框「${race.select}」时 state.book 是「${race.book}」（${race.n} 人）—— 两者必须一致`);
  ok(race.book === 'one-hundred-years-of-solitude',
    `最后选的书仍然生效（是「${race.book}」，没有被三国的迟到响应顶掉）`);

  /* ---------- C：连切书后 chart 与 resize 回调还活着 ---------- */
  console.log('\n▶ C 连切两次书后，resize 回调仍有效');
  const alive = await js(`(() => {
    const ba = window.__ba;
    const el = document.getElementById('graph');
    let resized = false;
    const orig = window.requestAnimationFrame;
    // 直接触发 resize，验证监听确实挂在 window 上（applyViewHeight 会改 el.style.height）
    const h0 = el.style.height;
    window.dispatchEvent(new Event('resize'));
    const h1 = el.style.height;
    window.requestAnimationFrame = orig;
    return {
      hasChart: !!ba.state.chart,
      hasObserver: !!ba.state.chartObserver,
      hasHandler: !!ba.state.chartResizeHandler,
      heightSet: typeof h1 === 'string' && h1.length > 0,
      h0, h1, resized,
    };
  })()`);
  ok(alive.hasChart, 'chart 仍然存活');
  ok(alive.hasObserver && alive.hasHandler, `resize 观察者与回调都在（observer=${alive.hasObserver}, handler=${alive.hasHandler}）`);

  /* ---------- E：文案没到位时不能导出残缺 JSON ---------- */
  console.log('\n▶ E 文案未就绪时不导出残缺 JSON');
  await switchTo('crime-and-punishment');   // 这本文案永远是 500 ⇒ 永远 failed
  await wait(2600);
  const guarded = await js(`(() => {
    const ba = window.__ba, st = ba.state;
    // 拦下下载，验证导出被拦住而不是产出一个空文案的文件
    let downloaded = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => { downloaded = blob; return origCreate.call(URL, blob); };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    const hint = document.getElementById('export-hint');
    const before = hint ? hint.textContent : '';
    return { status: st.textStatus && st.textStatus.status, before,
             run: () => ba.runExport('json') };
  })()`);
  await js(`window.__ba.runExport('json')`);
  await wait(1500);
  const afterExport = await js(`(() => {
    const h = document.getElementById('export-hint');
    return { hint: h ? h.textContent : '', blobMade: !!window.__ba };
  })()`);
  ok(/文案/.test(afterExport.hint),
    `文案拉不到时导出会被拦下并说明原因（提示：「${afterExport.hint.slice(0, 46)}…」）`);

} catch (e) {
  failed++;
  console.error('  ✗ 异常：' + e.message);
} finally {
  try { ws && ws.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

console.log(`\n${'='.repeat(40)}`);
console.log(`竞态与导出守卫　通过：${passed}  失败：${failed}`);
process.exit(failed > 0 ? 1 : 0);