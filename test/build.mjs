// v0.94：页脚构建版本水印 + 弃用模型名迁移
//  ① 页脚显示的是**实际加载到的** app.js 的 ?v=（不是 sw.js 写的、也不是 package.json 写的），
//     不一致时提示硬刷新 —— 这个项目吃过一次"部署后老访客仍跑旧代码"的亏，
//     而且用户报的"点某人画布空白"有一部分复现不了，第一嫌疑就是浏览器还在跑旧缓存。
//     取 ?v= 靠 document.currentScript：app.js 是普通 script（非 module），执行时它还有值；
//     这一条断言就是防"哪天改成 module 了、水印悄悄变成'未知'"。
//  ② localStorage 里存的 deepseek-chat（官方已公告弃用）读一次就迁移成 deepseek-flash ——
//     v0.93 只改了默认值没动已存的值，等于让用户的请求一直发给一个要被下线的模型名。
//     但**别的名字一律不动**：迁移只针对已公告弃用的那些，不擅自改人配置。
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
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const EDGE = requireBrowser();
const CDP_PORT = await freePort();
sweepStaleProfiles();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-bv-'));
const proc = spawn(EDGE, [...browserArgs(), `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 240 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
/* ⚠ 连不上 CDP 时必须**在这里**报错退出，不能往下走。
 *
 * 下面是 `new WebSocket(url)` 加一个只监听 onopen/onerror 的 promise ——
 * url 拿不到时它是 null，连不上时那个 promise **永远不 settle**，
 * 于是进程静默挂死：stdout / stderr **0 字节**，没有异常、没有退出码，
 * 看起来像"卡在某个断言上"，其实一条断言都还没开始跑。
 * 实测在门禁里撞过两次，每次要等十几分钟超时才发现。
 * （v0.100 把这道防线补齐到所有走 CDP 的测试文件。）
 */
if (!url) {
  console.error('  ✗ Edge 起来后连不上 CDP 端点 —— 这是**环境/负载**问题，不是断言失败。');
  console.error('    多半是刚借到的临时端口被别的进程抢走了（借出到 Edge 抢占之间有个毫秒级窗口，');
  console.error('    见 test/_free-port.mjs 的说明）—— 重跑一次通常就好。');
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
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' timeout')); } }, 40000); });
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

try {
  await send('Page.enable'); await send('Runtime.enable');
  const u = `http://127.0.0.1:${PORT}/index.html?book=one-hundred-years-of-solitude`;
  await send('Page.navigate', { url: u });
  for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart)`).catch(() => false)) break; await wait(100); }
  await wait(2500);

  console.log('① 页脚构建版本水印');
  const stamp = await js(`(() => ({ ver: (document.getElementById('build-ver')||{}).textContent, staleHidden: (document.getElementById('build-stale')||{hidden:true}).hidden, src: document.querySelector('script[src*="app.js"]').src }))()`);
  console.log('   ' + JSON.stringify(stamp));
  ok(/^v0\.\d+$/.test(stamp.ver || ''), `页脚显示版本号（${stamp.ver}）而不是"未知" —— document.currentScript 取到了 ?v=`);
  ok(stamp.staleHidden === true, '服务器 sw.js 与页面一致时，不显示"请硬刷新"');

  console.log('\n② 弃用模型名迁移');
  await js(`localStorage.setItem('ba-ai-model', 'deepseek-chat')`);
  await send('Page.navigate', { url: u });
  for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart)`).catch(() => false)) break; await wait(100); }
  await wait(2000);
  const after = await js(`(() => { window.__ba.aiConfig && window.__ba.aiConfig(); return { stored: localStorage.getItem('ba-ai-model') }; })()`);
  ok(after.stored === 'deepseek-flash', `存的 deepseek-chat 读一次后落盘成 ${after.stored}`);
  ok(fs.readFileSync(path.join(ROOT, 'shared/ai-config.js'), 'utf8').includes("'deepseek-flash'"),
    'shared/ai-config.js 的默认模型名也同步了（v0.93 漏了这个孤儿文件）');

  console.log('\n③ 别的模型名不许被改');
  await js(`localStorage.setItem('ba-ai-model', 'deepseek-reasoner')`);
  await send('Page.navigate', { url: u });
  for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart)`).catch(() => false)) break; await wait(100); }
  await wait(1800);
  await js(`(() => { window.__ba.aiConfig && window.__ba.aiConfig(); return null; })()`);
  const keep = await js(`localStorage.getItem('ba-ai-model')`);
  ok(keep === 'deepseek-reasoner', `非弃用名保持原样（${keep}）—— 迁移只针对已公告弃用的名字，不擅自改人配置`);
} catch (e) { console.error('异常：' + e.message); fail++; }
releaseProfile(profile);

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);