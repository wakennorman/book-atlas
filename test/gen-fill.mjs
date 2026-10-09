import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireBrowser, browserArgs } from './browser-locator.mjs';

/* v0.133b：「分组视图的墨迹占不满画布」。
 *
 * 用户报的现象：`gen-v`（分组·纵）图只占画布高度约 19%，上下大片空白。
 *
 * 根因不是缩放系数，而是**数据包围盒的长宽比和容器对不上**：
 * ECharts 的 graph 系列先把包围盒**等比**塞进「容器居中的 80%」（viewRect），
 * 再把 zoom 乘在那个适配系数上（见 memory/echarts-graph-auto-fits-data-bbox.md）
 * ⇒ 世界坐标整体缩放毫无意义，**只有长宽比有意义**。
 * 而 gen-v 原来是「一群人排成一行」：三国 881 人、10 个阵营、最大组 250 人、
 * stepCross=44 ⇒ 包围盒 11000×2204（长宽比 **5.0**），而画布是 2.29。
 * 等比适配 ⇒ 横向顶到 80% 就停 ⇒ 纵向只剩 37%（桌面 32%、手机 16%）。
 * 顺带一个更糟的后果：相邻节点的屏幕间距被压到 **2.5px**（手机 1.2px），
 * 符号缩到下限、人挤成一坨 —— 比"图看起来小"更伤。
 *
 * 这个测试**断言机制而不只是症状**：既量用户看得见的「墨迹占比 / 节点间距」，
 * 也量底层的「包围盒长宽比 vs 容器长宽比」。只断言症状的话，
 * 哪天有人把求解器改坏、恰好在某个视口上凑巧好看，就会漏过去。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDP_PORT = await freePort();
const EDGE = requireBrowser();

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-fill-'));
const proc = spawn(EDGE, [...browserArgs(), `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = '';
    r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 240 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
/* v0.165.3：原来这里是「拿不到 CDP ⇒ process.exit(0)」（跳过并报成功）——
 * 那是假绿：浏览器起不来时这条测试会显示通过，而一条断言都没跑。
 * 环境缺陷必须诚实地红。诊断信息只报事实，不猜原因。 */
if (!url) {
  console.error('  ✗ 拿不到 CDP 端点 —— 环境/启动失败，**不是断言失败**（不再跳过）');
  console.error(`    浏览器：${EDGE}　端口：${CDP_PORT}　profile：${profile}`);
  console.error(`    进程还活着吗：${proc.exitCode === null ? '是' : '否，已退出 code=' + proc.exitCode}`);
  console.error('    下一步：把浏览器的 stderr 抓出来看（现在多数测试是 stdio: ignore，扔掉了）');
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  process.exit(1);
}

const ws = new WebSocket(url);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 40000);
});
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };
const head = (s) => console.log(`\n▶ ${s}`);

const probe = () => js(`(() => {
  const st = window.__ba.state, ch = window.__ba.chart();
  const cs = ch.getModel().getSeriesByIndex(0).coordinateSystem;
  const r = document.getElementById('graph').getBoundingClientRect();
  /* 只统计**真实人物**节点：图注是虚拟节点（__gen_ 开头），
   * 它们落在包围盒外侧，算进去会把"墨迹"算大。 */
  const chars = (ch.getOption().series[0].data || []).filter(n => !String(n.id).startsWith('__gen_'));
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const n of chars) {
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
  }
  const p0 = cs.dataToPoint([minX, minY]), p1 = cs.dataToPoint([maxX, maxY]);
  const inkW = Math.abs(p1[0] - p0[0]), inkH = Math.abs(p1[1] - p0[1]);
  /* 相邻节点的**屏幕**间距：按 y 分行，行内按 x 排序量相邻两个的像素差。
   * ⚠ 必须量屏幕坐标，不能用世界坐标 × zoom（ECharts 还会再乘等比适配系数）。 */
  const rows = new Map();
  for (const n of chars) { const k = Math.round(n.y); if (!rows.has(k)) rows.set(k, []); rows.get(k).push(n.x); }
  let step = Infinity;
  for (const [, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const d = Math.abs(cs.dataToPoint([xs[i], 0])[0] - cs.dataToPoint([xs[i - 1], 0])[0]);
      if (d > 0.5) step = Math.min(step, d);
    }
  }
  return {
    canvas: [Math.round(r.width), Math.round(r.height)],
    bbox: [maxX - minX, maxY - minY],
    ink: [Math.round(inkW), Math.round(inkH)],
    pctW: Math.round(inkW / r.width * 100),
    pctH: Math.round(inkH / r.height * 100),
    step: step === Infinity ? null : Math.round(step * 10) / 10,
    n: chars.length,
    /* 全书人数 ≠ 实画人数：大书默认折叠 tier=minor 的次要人物（showMinor 默认 false），
     * 实测三国 881 人里画 327 个。把两个数都带出来，免得下一个看断言的人
     * 以为「少画了 554 个人」是 bug。 */
    total: st.book.characters.length,
  };
})()`);

/* 阈值。取「改之前一定红、改之后一定绿」的位置，别贴着实测值卡：
 *   · 墨迹高度 ≥ 70% —— 折行前是 16~37%，折行后 72~91%
 *   · 墨迹宽度 ≥ 60% —— 折行前 75~81%（宽度本来就顶满，所以这条不是本轮的变化）
 *   · 长宽比偏离 ≤ 45% —— cols/rows 是整数，解是离散的；实测最差 33%
 *   · 节点屏幕间距 ≥ 5px —— 折行前 1.2~3.6px（符号已贴 0.12 下限），折行后 5.6~13.4px
 */
const MIN_PCT_H = 70, MIN_PCT_W = 60, MAX_RATIO_DRIFT = 0.45, MIN_STEP_PX = 5;

try {
  await send('Page.enable');
  await send('Runtime.enable');

  for (const V of [
    { w: 1600, h: 1000, tag: '桌面 1600×1000' },
    { w: 900, h: 700, tag: '窄 900×700' },
    { w: 800, h: 586, tag: '窄 800×586（用户实测那档）' },
    { w: 390, h: 780, tag: '手机 390×780' },
  ]) {
    for (const view of ['gen-v', 'gen-h']) {
      head(`${V.tag} · ${view}`);
      await send('Emulation.setDeviceMetricsOverride', { width: V.w, height: V.h, deviceScaleFactor: 1, mobile: V.w < 700 });
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
      for (let i = 0; i < 300; i++) {
        if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length > 500)`).catch(() => false) === true) break;
        await wait(100);
      }
      await wait(2500);
      await js(`document.querySelectorAll('.modal-backdrop').forEach(e => { e.style.display = 'none'; })`);
      await js(`(() => { const b = document.getElementById('spoiler-off'); if (b) b.click(); })()`).catch(() => {});
      await wait(1500);
      await js(`document.querySelector('[data-view="${view}"]').click()`);
      await wait(4500);

      const d = await probe();
      const cw = d.canvas[0], chh = d.canvas[1];
      const canvasRatio = cw / chh;
      const bboxRatio = d.bbox[0] / Math.max(1e-6, d.bbox[1]);
      const drift = Math.abs(bboxRatio - canvasRatio) / canvasRatio;

      ok(d.n > 200, `画出来的人物节点数正常（全书 ${d.total} 人，实画 ${d.n} 个 —— 差的是默认折叠的 tier=minor）`);
      ok(d.pctH >= MIN_PCT_H, `墨迹占容器高 **${d.pctH}%** ≥ ${MIN_PCT_H}%（画布 ${cw}×${chh}，墨迹 ${d.ink[0]}×${d.ink[1]}）`);
      ok(d.pctW >= MIN_PCT_W, `墨迹占容器宽 **${d.pctW}%** ≥ ${MIN_PCT_W}%`);
      ok(drift <= MAX_RATIO_DRIFT,
        `包围盒长宽比贴近容器（包围盒 ${bboxRatio.toFixed(2)} vs 容器 ${canvasRatio.toFixed(2)}，偏离 **${Math.round(drift * 100)}%** ≤ ${MAX_RATIO_DRIFT * 100}%）`);
      ok(d.step !== null && d.step >= MIN_STEP_PX,
        `相邻节点屏幕间距 **${d.step}px** ≥ ${MIN_STEP_PX}px（太密会把人挤成一坨、符号缩到下限）`);
    }
  }
} catch (e) {
  failed++;
  console.error(`  ✗ ${e.message}`);
} finally {
  try { ws.close(); } catch { /* */ }
  try { proc.kill(); } catch { /* */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
  server.close();
}

console.log(`\n分组视图占满画布　通过：${passed}　失败：${failed}`);
process.exit(failed ? 1 : 0);