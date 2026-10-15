// 守主题按钮的**口径**：整条工具条写的都是「当前态」（拖动节点：开/关、次要人物：隐藏/显示、
// 剧透保护：开/关…），主题按钮原来写的是**动作**（`dark ? '☀️ 日间' : '🌙 夜间'`），
// 于是**白天里按钮显示「夜间」** —— 用户报的就是这条。
//
// 这个测试盯三件事：
//   ① 首屏（默认白天）按钮必须是「☀️ 日间」
//   ② 点一次进夜间 → 按钮变成「🌙 夜间」；再点回来 → 又变「☀️ 日间」
//   ③ index.html 的静态兜底也是「日间」（无 JS / 首帧不闪成"夜间"）
import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';
import { requireBrowser, browserArgs } from './browser-locator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 0;   // v0.97：临时端口，listen 之后回填
const CDP_PORT = await freePort();
const EDGE = requireBrowser();

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/vnd.microsoft.icon' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;   // v0.97：临时端口
sweepStaleProfiles();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-thm-'));
const proc = spawn(EDGE, [...browserArgs(), `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 240 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
/* ⚠ 连不上 CDP 时必须**在这里**报错退出 —— 否则 new WebSocket(null) 那个 promise 永远不 settle，
 *   进程静默挂死、0 字节输出，看起来像"卡在断言上"（v0.100 给所有 CDP 测试补的同一条防线）。 */
if (!url) {
  console.error('  ✗ Edge 起来后连不上 CDP 端点 —— 这是**环境/负载**问题，不是断言失败。');
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  releaseProfile(profile);
  process.exit(1);
}

const ws = new WebSocket(url);
await Promise.race([
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }),
  new Promise((_, rej) => setTimeout(() => rej(new Error('CDP WebSocket 10 秒内没连上')), 10000)),
]);
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 25000); });
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

try {
  /* ③ 静态 HTML 兜底（无 JS / 首帧）：`<html>` 不写 data-theme ⇒ 白天 ⇒ 文案必须是「日间」。
   *    原来写的是「夜间」（动作口径），首帧会先闪一下"夜间"，JS 跑完又改回"日间"。 */
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = /id="theme-btn"[\s\S]{0,400}?<\/button>/.exec(html);
  const staticLabel = m ? (/data-s2t>([^<]+)</.exec(m[0]) || [])[1] : null;
  console.log(`\n▶ ① 静态兜底：#theme-btn 的初值「${staticLabel}」`);
  ok(staticLabel === '日间', `静态兜底写「日间」（白天是默认态），实际「${staticLabel}」`);
  ok(!/data-s2t>夜间</.test(html), '静态 HTML 里不再有「夜间」这个初值');

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
  for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart)`).catch(() => false)) break; await wait(100); }
  await wait(2500);

  const read = () => js(`(() => {
    const b = document.getElementById('theme-btn');
    return { theme: document.documentElement.dataset.theme, label: b ? b.textContent.trim() : null,
             bg: getComputedStyle(document.body).backgroundColor };
  })()`);

  /* ① 首屏：白天 ⇒ 按钮必须是「日间」 */
  const a = await read();
  console.log(`\n▶ ② 首屏：theme=${a.theme} 按钮「${a.label}」背景 ${a.bg}`);
  ok(a.theme === 'light', `首屏是白天（data-theme=light），实际 ${a.theme}`);
  ok(/☀️\s*日间/.test(a.label || ''), `首屏按钮显示「☀️ 日间」（白天显示白天），实际「${a.label}」`);

  /* ② 点一次进夜间 ⇒ 「🌙 夜间」且页面真的变深色 */
  await js(`document.getElementById('theme-btn').click()`);
  await wait(600);
  const b = await read();
  console.log(`   点一次：theme=${b.theme} 按钮「${b.label}」背景 ${b.bg}`);
  ok(b.theme === 'dark', `点一次进夜间（data-theme=dark），实际 ${b.theme}`);
  ok(/🌙\s*夜间/.test(b.label || ''), `夜间按钮显示「🌙 夜间」，实际「${b.label}」`);
  ok(b.bg !== a.bg, `背景真的换了（${a.bg} → ${b.bg}）`);

  /* ③ 再点一次回白天 ⇒ 「☀️ 日间」 */
  await js(`document.getElementById('theme-btn').click()`);
  await wait(600);
  const c = await read();
  console.log(`   再点一次：theme=${c.theme} 按钮「${c.label}」背景 ${c.bg}`);
  ok(c.theme === 'light' && /☀️\s*日间/.test(c.label || ''), `回到白天且按钮回到「☀️ 日间」，实际 theme=${c.theme}「${c.label}」`);
  ok(c.bg === a.bg, '背景回到首屏那一档');

  /* ④ 与工具条其它按钮同口径：都写**当前态**，没人写动作 */
  const peers = await js(`(() => {
    const g = (id) => { const e = document.getElementById(id); return e ? e.textContent.trim() : null; };
    return { drag: g('drag-btn'), minor: g('minor-btn'), derived: g('derived-btn'), spoiler: g('spoiler-btn') };
  })()`);
  console.log('   同伴按钮（同样写当前态）：' + JSON.stringify(peers));
  ok(peers.drag === '拖动节点：关' || peers.drag === '拖动节点：开', `拖动节点写当前态（实际「${peers.drag}」）`);
  ok(/：隐藏$|：显示$/.test(peers.minor || ''), `次要人物写当前态（实际「${peers.minor}」）`);
  ok(/：隐藏$|：显示$/.test(peers.derived || ''), `族谱补全写当前态（实际「${peers.derived}」）`);

  console.log(`\n${failed ? '✗' : '✓'} 主题按钮口径（当前态 vs 动作态）：${passed} 通过，${failed} 失败`);
} catch (e) { failed++; console.error('异常：' + e.message); }
try { ws.close(); } catch { /* 忽略 */ }
try { proc.kill(); } catch { /* 忽略 */ }
try { server.close(); } catch { /* 忽略 */ }
releaseProfile(profile);
process.exit(failed ? 1 : 0);
