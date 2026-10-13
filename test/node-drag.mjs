/**
 * v0.213：图注随「拖动节点」开关切换 + 两种模式的分工（用户报的两件事）。
 *
 * 背景（用户原话）：
 *   ① 「我点击'拖动节点'后，关系图下面的图注还是'…双击图的空白＝复位视图'，
 *       但是这种情况下'双击图的空白＝复位视图'明显是不对的。」
 *   ② 拖动模式里按在节点上拖的是节点、不是画布 —— 图注得把当前模式的三件事说对。
 *
 * 本文件守住的判据：
 *   ① 图注跟着开关走：默认态三段式原文不变；开「拖动节点」后换成
 *      「节点上按住＝搬节点 / 空白按住＝平移 / 滚轮缩放 / 复位走按钮」，且不再提双击复位
 *   ② 拖动模式（真实鼠标拖动节点）：节点跟手 1:1、画布不平移、松手后位置留着、
 *      点空白后位置还在、不会误开人物面板、线跟着节点走
 *   ③ 双击空白复位：默认态照旧；拖动态停用（摆节点时误双击不该清掉调好的视野）
 *   ④ 默认态在节点上按住拖动＝平移画布（节点不动）—— 两种模式不打架
 *   ⑤ 静态文案：右栏默认提示与「怎么用」④ 不再出现不带开关限定的「拖拽可移动节点」，
 *      也不再说「一点空白…位置就回到布局」（实测位置会留着，见 test ②）
 *
 * ⚠ 全部走**真实鼠标事件**（CDP Input.dispatchMouseEvent）—— 节点命中要靠 zrender
 *   的 hit-test，合成事件（handler.dispatch，test/roam.mjs 的 dragBy 那种）到不了
 *   Draggable 的链路上（一次性探针实测：合成 mousedown 不触发 zrender Draggable）。
 * ⚠ Input.* 给 300 秒超时：口径同 test/lock.mjs（覆盖机器负载，不是代码固有开销）。
 */
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
let PORT = 0;
const CDP_PORT = await freePort();
const EDGE = requireBrowser();
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
PORT = server.address().port;
sweepStaleProfiles();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-cur-'));
const proc = spawn(EDGE, [...browserArgs(), `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 240 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
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
const CDP_TIMEOUT = (method) => (String(method).startsWith('Input.') ? 300000 : 30000);
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, CDP_TIMEOUT(method));
});
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, ...extra });

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

/* ---------- 页面探针小工具 ---------- */
const openBook = async () => {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
  for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length>500)`).catch(() => false)) break; await wait(100); }
  await wait(2500);
  await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`).catch(() => {});
  await wait(1500);
  await js(`window.scrollTo(0,0)`);
};
/** 挑一个"靠近画布中心 + 有边"的节点，记下数据下标与屏幕坐标 */
const pickNode = () => js(`(() => {
  const b = window.__ba, st = b.state, chart = st.chart;
  const sm = chart.getModel().getSeriesByIndex(0);
  const d = sm.getData();
  const cv = document.getElementById('graph').querySelector('canvas');
  const W = cv.clientWidth, H = cv.clientHeight;
  let best = null;
  for (let i = 0; i < d.count(); i++) {
    const id = d.getId(i); if (!id || String(id).startsWith('__gen_')) continue;
    const pos = st.pos.get(id); if (!pos) continue;
    if ((st.adj.get(id) || []).length < 2) continue;
    const px = chart.convertToPixel({ seriesIndex: 0 }, [pos.x, pos.y]);
    if (!px) continue;
    const dc = Math.hypot(px[0] - W / 2, px[1] - H / 2);
    if (dc > 240) continue;
    if (!best || dc < best.dc) best = { i, id, dc, px };
  }
  return best ? { i: best.i, id: best.id } : null;
})()`);
const canvasRect = () => js(`(() => { const r = document.getElementById('graph').querySelector('canvas').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; })()`);
/** 找一个**真空白**点（findHover 无命中）——双击/平移都从真空白出发，不依赖人造坐标 */
const blankSpot = () => js(`(() => {
  const b = window.__ba, st = b.state, chart = st.chart;
  const sm = chart.getModel().getSeriesByIndex(0);
  const view = chart.getViewOfSeriesModel(sm);
  const zr = chart.getZr();
  const cv = document.getElementById('graph').querySelector('canvas');
  const W = cv.clientWidth, H = cv.clientHeight;
  // ⚠ 只"没命中图元"不够 —— RoamController 的 pointerChecker 还要求点落在
  //   **图元组的包围盒**里（fit 后四角是给图注留的 gutter，落在那里拖不动画布，
  //   而 findHover 照样返回 null）。所以两个条件都查，与 pointerChecker 对齐。
  let box = null;
  try {
    const g = view.group;
    const r = g.getBoundingRect();
    r.applyTransform(g.transform);
    box = r;
  } catch (e) { box = null; }
  const inside = (x, y) => !box || box.contain(x, y);
  const cands = [[W / 2, H / 2], [W * 0.35, H * 0.5], [W * 0.65, H * 0.5], [W / 2, H * 0.3], [W / 2, H * 0.7], [24, 24], [W - 24, 24], [24, H - 24], [W - 24, H - 24], [W / 2, 20], [W / 2, H - 20], [20, H / 2], [W - 20, H / 2]];
  for (const [x, y] of cands) {
    const hit = zr.handler.findHover(x, y);
    if ((!hit || !hit.target) && inside(x, y)) return [x, y];
  }
  return null;
})()`);
/** 一次性快照：节点世界坐标 / 视野 / 面板 / 拖动开关 / 关联边端点 */
const snap = (id, i) => js(`(() => {
  const b = window.__ba, st = b.state, chart = st.chart;
  const sm = chart.getModel().getSeriesByIndex(0);
  const d = sm.getData();
  const pos = st.pos.get(${JSON.stringify(id)});
  const graph = d.graph;
  let edgeEnd = null;
  if (graph) graph.eachEdge((edge) => {
    if (edgeEnd) return;
    if (edge.node1.dataIndex === ${i} || edge.node2.dataIndex === ${i}) {
      const l = edge.getLayout();
      if (l && l.length >= 2) edgeEnd = [+l[0][0].toFixed(3), +l[0][1].toFixed(3), +l[1][0].toFixed(3), +l[1][1].toFixed(3)];
    }
  });
  return {
    pos: pos ? [+pos.x.toFixed(3), +pos.y.toFixed(3)] : null,
    screen: pos ? chart.convertToPixel({ seriesIndex: 0 }, [pos.x, pos.y]).map((v) => +v.toFixed(2)) : null,
    vc: (st.viewCenter || []).map((v) => Math.round(v)),
    zoom: +st.zoom.toFixed(3),
    nodeDrag: !!st.nodeDrag,
    panelKind: st.panelKind || null,
    edgeEnd,
  };
})()`);
/** 在 pos0 与 pos1 之间分 step 步真实拖动（步长 ≤60px，终点不越画布） */
const realDrag = async (x0, y0, x1, y1) => {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 60));
  await mouse('mousePressed', x0, y0);
  await wait(60);
  for (let k = 1; k <= steps; k++) {
    await mouse('mouseMoved', x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps);
    await wait(45);
  }
  await mouse('mouseReleased', x1, y1);
  await wait(450);
};
const near = (a, b, tol = 4) => Math.abs(a - b) <= tol;

try {
  await send('Page.enable'); await send('Runtime.enable');
  await openBook();
  const pick = await pickNode();
  ok(!!pick, `挑到靠近画布中心、有连线的节点（${pick ? pick.id : '没挑到'}）`);
  if (!pick) throw new Error('挑不到节点，后续断言失去意义');
  const { id, i } = pick;
  console.log(`  目标节点：${id}（数据下标 ${i}）`);

  /* ============ ① 图注跟着「拖动节点」开关走 ============ */
  console.log('\n▶ ① 图注随模式切换（用户报的原始 bug）');
  const hintText = () => js(`(() => { const el = document.querySelector('.graph-pan-hint'); return el ? el.textContent.trim() : null; })()`);
  const hintOff = await hintText();
  console.log(`    默认态：「${hintOff}」`);
  ok(/在图上按住拖动＝平移画布/.test(hintOff || '') && /双击图的空白＝复位视图/.test(hintOff || ''), '默认态图注原文不变（含"双击图的空白＝复位视图"）');
  await js(`document.getElementById('drag-btn').click()`);
  await wait(800);   // 等 resetRoam 的重建跑完
  const hintOn = await hintText();
  console.log(`    拖动态：「${hintOn}」`);
  ok(!!hintOn && hintOn !== hintOff, '开「拖动节点」后图注换成另一段');
  ok(/节点上按住拖动＝搬动节点/.test(hintOn || ''), '拖动态说清"节点上按住＝搬动节点"');
  ok(/空白.*平移画布/.test(hintOn || ''), '拖动态说清"空白上按住＝平移画布"');
  ok(!/双击/.test(hintOn || ''), '拖动态整段不再提双击复位（用户原话：这种情况下明显不对）');
  ok(/复位视图/.test(hintOn || ''), '拖动态把"复位视野"指给「复位视图」按钮');
  await js(`document.getElementById('drag-btn').click()`);
  await wait(800);
  ok((await hintText()) === hintOff, '关回去图注恢复默认态原文');

  /* ============ ② 拖动模式：真实鼠标拖节点 ============ */
  console.log('\n▶ ② 拖动模式下拖节点：跟手 / 不平移 / 位置留着 / 不误开面板 / 线跟着走');
  await js(`document.getElementById('drag-btn').click()`);   // 再开
  await wait(800);
  const before = await snap(id, i);
  const rect = await canvasRect();
  const sx = rect.left + before.screen[0], sy = rect.top + before.screen[1];
  const DX = 120, DY = 80;
  await mouse('mousePressed', sx, sy);
  await wait(60);
  const midSteps = 3, totalSteps = 5;
  for (let k = 1; k <= midSteps; k++) { await mouse('mouseMoved', sx + (DX * k) / totalSteps, sy + (DY * k) / totalSteps); await wait(45); }
  const mid = await snap(id, i);
  for (let k = midSteps + 1; k <= totalSteps; k++) { await mouse('mouseMoved', sx + (DX * k) / totalSteps, sy + (DY * k) / totalSteps); await wait(45); }
  await mouse('mouseReleased', sx + DX, sy + DY);
  await wait(600);
  const after = await snap(id, i);
  console.log(`    拖前 screen=${JSON.stringify(before.screen)} pos=${JSON.stringify(before.pos)} vc=${JSON.stringify(before.vc)}`);
  console.log(`    拖后 screen=${JSON.stringify(after.screen)} pos=${JSON.stringify(after.pos)} vc=${JSON.stringify(after.vc)}`);
  ok(after.screen && near(after.screen[0] - before.screen[0], DX, 4) && near(after.screen[1] - before.screen[1], DY, 4), `节点跟手 1:1（屏幕位移 ${after.screen[0] - before.screen[0]}, ${after.screen[1] - before.screen[1]} ≈ 鼠标 ${DX}, ${DY}）`);
  ok(JSON.stringify(after.vc) === JSON.stringify(before.vc), `拖节点时画布不平移（viewCenter 保持 ${JSON.stringify(after.vc)}）`);
  const moved = Math.hypot(after.pos[0] - before.pos[0], after.pos[1] - before.pos[1]);
  ok(moved > 5, `松手后位置留着（世界坐标移动了 ${moved.toFixed(1)}）`);
  ok(!!after.edgeEnd && !!mid.edgeEnd && JSON.stringify(mid.edgeEnd) !== JSON.stringify(before.edgeEnd), '拖动过程中关联边的端点实时跟着走（松手前就已更新）');
  const nearestEnd = after.edgeEnd ? Math.min(Math.hypot(after.edgeEnd[0] - after.pos[0], after.edgeEnd[1] - after.pos[1]), Math.hypot(after.edgeEnd[2] - after.pos[0], after.edgeEnd[3] - after.pos[1])) : 1e9;
  ok(nearestEnd < 1, `松手后连回的线端点落在节点新位置上（偏差 ${nearestEnd.toFixed(3)}）`);
  ok(!after.panelKind, `拖完不会误开人物面板（panelKind=${after.panelKind}）`);

  // 点一下空白：位置还在（帮助 ④ 以前说"一点空白就回布局"，实测不成立，已改文案）
  const blank = await blankSpot();
  ok(!!blank, '找到图上的真空白点');
  if (blank) {
    const br = await canvasRect();
    await mouse('mousePressed', br.left + blank[0], br.top + blank[1]);
    await wait(50);
    await mouse('mouseReleased', br.left + blank[0], br.top + blank[1]);
    await wait(500);
    const afterBlank = await snap(id, i);
    ok(JSON.stringify(afterBlank.pos) === JSON.stringify(after.pos), '点空白后节点位置还在（不悄悄回布局）');
  }

  /* ============ ③ 双击空白复位：拖动态停用 / 默认态照旧 ============ */
  console.log('\n▶ ③ 双击空白＝复位视野：只在默认态生效');
  const panThenDblclick = async () => {
    const b0 = await blankSpot();
    if (!b0) return null;
    const br = await canvasRect();
    const bx = br.left + b0[0], by = br.top + b0[1];
    await realDrag(bx, by, bx + 150, by);           // 先把画布拖歪
    const panned = await js(`window.__ba.state.viewCenter.map((v) => Math.round(v)).join(',')`);
    // 平移之后原来那片空白可能已经压到节点上 —— 重新找一片空白再双击
    // （双击落在节点上时 e.target 非空，处理器直接 return，什么都测不到）
    const b1 = await blankSpot();
    if (!b1) return { panned, now: null };
    const br2 = await canvasRect();
    const dx0 = br2.left + b1[0], dy0 = br2.top + b1[1];
    await mouse('mousePressed', dx0, dy0, { clickCount: 1 });
    await mouse('mouseReleased', dx0, dy0, { clickCount: 1 });
    await wait(40);
    await mouse('mousePressed', dx0, dy0, { clickCount: 2 });
    await mouse('mouseReleased', dx0, dy0, { clickCount: 2 });
    await wait(600);
    const now = await js(`window.__ba.state.viewCenter.map((v) => Math.round(v)).join(',')`);
    return { panned, now };
  };
  const d3 = await panThenDblclick();
  console.log(`    拖动态：拖到 ${d3 && d3.panned} → 双击后 ${d3 && d3.now}`);
  ok(!!d3 && d3.panned !== '0,0' && d3.now === d3.panned, '拖动模式下双击空白不复位视野（摆节点时误双击不清视野）');
  await js(`document.getElementById('drag-btn').click()`);   // 关掉（会顺手复位视野）
  await wait(800);
  const d3b = await panThenDblclick();
  console.log(`    默认态：拖到 ${d3b && d3b.panned} → 双击后 ${d3b && d3b.now}`);
  ok(!!d3b && d3b.panned !== '0,0' && d3b.now === '0,0', '默认态双击空白仍旧复位视野（老行为不回归）');

  /* ============ ④ 默认态：在节点上按住拖动＝平移画布 ============ */
  console.log('\n▶ ④ 默认态按在节点上拖动：平移画布，节点不动');
  const b4 = await snap(id, i);
  const r4 = await canvasRect();
  const n4x = r4.left + b4.screen[0], n4y = r4.top + b4.screen[1];
  await realDrag(n4x, n4y, n4x + 120, n4y + 80);
  const a4 = await snap(id, i);
  console.log(`    拖前 pos=${JSON.stringify(b4.pos)} vc=${JSON.stringify(b4.vc)} → 拖后 pos=${JSON.stringify(a4.pos)} vc=${JSON.stringify(a4.vc)}`);
  ok(Math.abs(a4.pos[0] - b4.pos[0]) < 0.5 && Math.abs(a4.pos[1] - b4.pos[1]) < 0.5, '默认态拖节点：节点坐标不动');
  ok(JSON.stringify(a4.vc) !== JSON.stringify(b4.vc), '默认态拖节点：平移的是画布（viewCenter 变了）');

  /* ============ ⑤ 静态文案：不带开关限定的旧写法要绝迹 ============ */
  console.log('\n▶ ⑤ 静态文案核对');
  const copy = await js(`(() => ({
    // 用户真正看到的：右栏欢迎面板（page load 后 #panel 的内容就是它）
    welcome: (document.querySelector('#panel .hint') || {}).textContent || '',
    help: (document.getElementById('help-modal') || {}).textContent || '',
  }))()`);
  // 静态 HTML（JS 启动前的右栏兜底文案，line 202）单独抓原文核对
  const staticHtml = await js(`fetch('/index.html').then((r) => r.text())`);
  console.log(`    欢迎面板：「${copy.welcome.trim().slice(0, 60)}…」`);
  ok(/打开上方「拖动节点」/.test(copy.welcome), '欢迎面板写清了"要拖单个节点请打开上方「拖动节点」"');
  ok(!/拖拽可移动节点/.test(copy.welcome), '欢迎面板没有无限定的"拖拽可移动节点"');
  ok(!/拖拽可移动节点/.test(staticHtml || ''), '静态 HTML 兜底文案不再裸写"拖拽可移动节点"');
  ok(/开「拖动节点」后可按住圆点/.test(staticHtml || ''), '静态 HTML 兜底文案带上了开关限定');
  ok(!/一点空白|先别点别处/.test(copy.help), '「怎么用」④ 不再谎称"一点空白位置就回布局"');
  ok(/按住任意圆点拖动/.test(copy.help), '「怎么用」④ 仍教了怎么拖');

  console.log(`\n${failed ? '✗' : '✓'} 拖动节点与图注：${passed} 通过，${failed} 失败`);
} catch (e) { failed++; console.error('异常：' + (e && e.stack || e)); }
releaseProfile(profile);
try { proc.kill(); } catch { /* 忽略 */ }
process.exit(failed ? 1 : 0);
