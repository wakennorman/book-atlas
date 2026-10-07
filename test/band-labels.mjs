import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* v0.133：分组图注（「曹魏 / 蜀汉 / 东吴…」）的**视觉可读性**。
 *
 * 起因（用户实测，视口 800×586 / 容器 778×340，三国 881 人，gen-v）：
 *   十个阵营图注的屏幕纵向间距只有 12.12px，而字号 11.5px
 *   ⇒ 必然叠成一团黑字。而 `labelLayout` 写着 `hideOverlap: false`
 *     （刻意禁用隐藏：图注承载的是"这一组有多少人"，藏掉就等于说这个阵营不存在）。
 *
 * ⚠ 这个测试**量的是真正画出来的文字矩形**，不是 option 里的坐标、也不是 CSS 属性。
 *   理由（v0.131 的教训）：只测机械属性会漏掉"坐标算得对但视觉上叠在一起"。
 *   取法：zrender 显示列表 → 找出 text 且文字 ∈ bandLabels 的元素 → 手工叠父级变换
 *   → 得到画布内真实矩形 → 两两判重叠。
 *   实测交叉验证过：真实矩形间距 23~24px vs 节点坐标推算 23.72px，吻合。
 *
 * 守住的东西：
 *   ① 三种视口下 gen-v 的图注**真实矩形互不重叠**（本轮修的那条）
 *   ② 桌面视口下**不许抽稀**（间距本来就够，抽了就白丢信息）
 *   ③ 抽稀后**至少留 1 个**，且必须包含第一个（最上一组不能凭空消失）
 *   ④ gen-h 在窄视口下也不重叠（它本来就没坏，守住别被改坏）
 *   ⑤ 放大之后抽稀要**放松**（zoom 3 时图注散开，该多显示）
 *   ⑥ 图注不能跑到画布外（position:'left' 落在左侧 gutter，抽稀不该把它推出画布）
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDP_PORT = await freePort();
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.log('  (跳过) 找不到 Edge/Chrome'); process.exit(0); }

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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-band-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = '';
    r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
if (!url) { console.log('  (跳过) 拿不到 CDP'); process.exit(0); }

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

/* 量出图注**真实绘制**的矩形。
 * ⚠ `el.getBoundingRect()` 给的是元素**局部**坐标（实测恒为 [-23,-6,23,12]，
 *   跟画布位置无关），必须叠上从根到该元素的父级 x/y/scale 才是画布坐标。 */
const probe = () => js(`(() => {
  const ch = window.__ba.chart(), zr = ch.getZr(), st = window.__ba.state;
  const names = new Set([...st.bandLabels.values()]);
  const ordered = [...st.bands.keys()].map(g => st.bandLabels.get(g) || String(g));
  const toCanvas = (el, r) => {
    let sx = 1, sy = 1, tx = 0, ty = 0;
    const chain = [];
    for (let n = el; n; n = n.parent) chain.unshift(n);
    for (const n of chain) {
      tx += (n.x || 0) * sx;
      ty += (n.y || 0) * sy;
      sx *= (n.scaleX == null ? 1 : n.scaleX);
      sy *= (n.scaleY == null ? 1 : n.scaleY);
    }
    return { x: tx + r.x * sx, y: ty + r.y * sy, w: r.width * sx, h: r.height * sy };
  };
  const rects = [];
  for (const el of zr.storage.getDisplayList(true, true)) {
    /* ⚠ 别按 type === 'text' 过滤：zrender 把标签内容拆成 **tspan**，
     *   style.text 挂在 tspan 上（第一版这么写，一个都捞不到 —— 量了 0 个却报"不重叠"，
     *   差点又变成"只测机械属性"的自欺）。这里按「style.text ∈ bandLabels」认人。 */
    if (el.style && typeof el.style.text === 'string' && names.has(el.style.text)) {
      rects.push({ t: el.style.text, ...toCanvas(el, el.getBoundingRect()) });
    }
  }
  const g = document.getElementById('graph').getBoundingClientRect();
  return {
    rects,
    ordered,                                    // band 的主轴顺序（第一项 = 最上/最左那组）
    fontSize: 11.5,
    stride: st.bandStride,
    canvas: { w: Math.round(g.width), h: Math.round(g.height) },
    bandCount: st.bands.size,
  };
})()`);

/** 两两判重叠（真实矩形，不是坐标差） */
function overlaps(rects) {
  const bad = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0.5 && oy > 0.5) bad.push({ a: a.t, b: b.t, ox: Math.round(ox * 10) / 10, oy: Math.round(oy * 10) / 10 });
    }
  }
  return bad;
}
const gapOf = (rects) => {
  const ys = [...rects].sort((a, b) => a.y - b.y);
  let min = Infinity;
  for (let i = 1; i < ys.length; i++) min = Math.min(min, ys[i].y - ys[i - 1].y);
  return min;
};
const setView = async (v) => { await js(`document.querySelector('[data-view="${v}"]').click()`); await wait(4500); };

try {
  await send('Page.enable');
  await send('Runtime.enable');

  const VIEWPORTS = [
    { w: 1600, h: 1000, tag: '桌面 1600×1000' },
    { w: 800, h: 586, tag: '窄 800×586（用户实测那档）' },
    { w: 390, h: 780, tag: '手机 390×780' },
  ];

  for (const V of VIEWPORTS) {
    head(`${V.tag} · gen-v（问题视图）`);
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

    await setView('gen-v');
    const d = await probe();
    const bad = overlaps(d.rects);

    ok(d.rects.length >= 1, `图注至少留下 1 个（画了 ${d.rects.length} 个 / 共 ${d.bandCount} 组）`);
    ok(bad.length === 0,
      `真实文字矩形互不重叠（画了 ${d.rects.length} 个，最小间距 ${gapOf(d.rects) === Infinity ? '—' : Math.round(gapOf(d.rects) * 10) / 10 + 'px'}）` +
      (bad.length ? ` —— 重叠：${bad.map((b) => `${b.a}×${b.b} ${b.ox}×${b.oy}px`).join('；')}` : ''));
    ok(d.rects.every((r) => r.y >= -1 && r.y + r.h <= d.canvas.h + 1 && r.x >= -1),
      `图注都在画布矩形内（画布 ${d.canvas.w}×${d.canvas.h}）`);
    if (d.rects.length) {
      ok(d.rects.some((r) => r.t === d.ordered[0]),
        `第一组「${d.ordered[0]}」始终可见（抽稀不能把最上/最左那组抽没）`);
    }
    if (V.w >= 1400) {
      ok(d.rects.length === d.bandCount,
        `宽视口下**不抽稀**（${d.rects.length}/${d.bandCount}，stride=${d.stride}）—— 间距本来就够，抽了就是白丢信息`);
    }

    head(`${V.tag} · gen-h（对照组：本来就没坏，守住别改坏）`);
    await setView('gen-h');
    const h = await probe();
    const hBad = overlaps(h.rects);
    ok(hBad.length === 0,
      `gen-h 图注互不重叠（画了 ${h.rects.length} 个）` +
      (hBad.length ? ` —— 重叠：${hBad.map((b) => `${b.a}×${b.b}`).join('；')}` : ''));
    ok(h.rects.length === h.bandCount || V.w < 1400,
      `gen-h 宽视口下不该被抽稀（${h.rects.length}/${h.bandCount}，stride=${h.stride}）` +
      (h.rects.length < h.bandCount ? '（窄视口下抽稀是**应该**的：间距 20.6px < 最宽图注 40px）' : ''));
    ok(h.rects.every((r) => r.y >= -1 && r.y + r.h <= h.canvas.h + 1 && r.x >= -1),
      `gen-h 图注都在画布矩形内（画布 ${h.canvas.w}×${h.canvas.h}，越界 ${h.rects.filter((r) => r.y < -1 || r.y + r.h > h.canvas.h + 1 || r.x < -1).map((r) => r.t).join(' ') || '无'}）`);
  }

  /* ===== 放大之后仍然不重叠，且抽稀要放松 ===== */
  head('放大后');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true });
  await setView('gen-v');
  const z1 = await probe();
  ok(overlaps(z1.rects).length === 0, `窄视口 gen-v 图注不重叠（画了 ${z1.rects.length}/${z1.bandCount} 个，stride=${z1.stride}）`);
  await js(`(() => { const ch = window.__ba.chart(); ch.dispatchAction({ type: 'graphRoam', zoom: 3, originX: 200, originY: 300 }); })()`);
  await wait(1500);
  const z2 = await probe();
  ok(overlaps(z2.rects).length === 0, `放大到 3 倍后仍不重叠（画了 ${z2.rects.length} 个）`);
  /* 抽稀只该在间距不够时发生；放大后间距够了，步长不该变大（否则是白丢信息）。
   * ⚠ v0.133 布局修好之后，手机视口下 gen-v 的间距已经够 10 个图注全显示（stride=1），
   *   所以这条从「必须抽稀」改成「步长不得变大」—— 断言方向是放宽，不是收紧。 */
  ok(z2.stride <= z1.stride, `放大后抽稀步长不应变大（${z1.stride} → ${z2.stride}）`);
  ok(z2.rects.length >= z1.rects.length, `放大后可见图注不少于放大前（${z1.rects.length} → ${z2.rects.length}）`);
} catch (e) {
  failed++;
  console.error(`  ✗ ${e.message}`);
} finally {
  try { ws.close(); } catch { /* */ }
  try { proc.kill(); } catch { /* */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
  server.close();
}

console.log(`\n分组图注可读性　通过：${passed}　失败：${failed}`);
process.exit(failed ? 1 : 0);