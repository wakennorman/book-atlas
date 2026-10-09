import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';
import { requireBrowser } from './browser-locator.mjs';

// v89：ECharts 的 graph 系列**不会**把世界坐标 1:1 画到像素上 —— 它先把数据包围盒
// **等比**塞进「容器居中 80%」的 viewRect，再把 zoom 乘在那个适配系数之上。
// 所以：
//   · fitPositions 里那个缩放系数 s 对渲染毫无影响（长宽比不变 ⇒ 画面逐像素一样）
//   · 凡是拿 s 或 zoom 当「世界→像素」尺度的代码都算错了一个数量级
//
// 起因正是「分组·横」：曹魏 250 人排成一根 12500 长的竖线、群组轴才 2160 ⇒ 长宽比 1:5.8，
// 而画布是 2:1 ⇒ 被压到 0.088 的尺度，群组轴只剩 83px 宽、十个阵营图注全叠在一起；
// 再加上 focusViewOn 把 zoom 当像素尺度，点谁就把视野怼到那一小块上 ⇒ 一片空白。
//
// 这个测试守住三件事：
//   ① state.pxScale 的解析式 == ECharts 真实的 cs.scaleX（一旦 ECharts 改了适配算法就会红）
//   ② 「横」视图的群组轴真的铺开画布宽度（回归护栏：坏掉时是 7%）
//   ③④ 连点若干个人 + 中间反复缩放，任何一步都不会"视口里几乎没有节点"、高亮也够大
//
// 实测过的回退-变红对应（别再怀疑这些是不是假绿）：
//   · 把「横」布局回退成「一群人一根线」  → ② 红（7% 宽）
//   · 把 pxScale 回退成 fitLast           → ⑤ 红（小书 gen-h 误差 26%）
//   · 把 focusViewOn 的换算回退成 unitPx=1 → 抓不到。布局修好之后 ECharts 的等比适配系数
//     只在 0.95～1.4 之间晃，当成 1 只差 10%，③④ 都还有大片余量。
//     ⇒ 真正守住这行换算的是 ①：只要 pxScale 还对，focusViewOn 就不会错。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 0;   // v0.97：临时端口，listen 之后回填
const CDP_PORT = await freePort();
const EDGE = requireBrowser();

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-scale-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }

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
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));  /* v0.115：CDP 响应不来时 pending 条目永不 settle ⇒ 静默挂死。 */ setTimeout(() => { if (pending.delete(id)) reject(new Error(method + ' 30 秒无响应')); }, 30000);});
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

/** 以 zrender 图元为准量真实墨迹 —— ECharts 的 convertToPixel 也可，但图元更硬。 */
const probe = () => js(`(() => {
  const ba = window.__ba, st = ba.state, ch = ba.chart();
  const el = document.getElementById('graph');
  const W = el.clientWidth, H = el.clientHeight;
  const cs = ch.getModel().getSeriesByIndex(0).coordinateSystem;
  const vals = [...st.pos.values()];
  const nNodes = vals.length;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
  for (const e of ch.getZr().storage.getDisplayList()) {
    if (e.type !== 'path' && e.type !== 'circle') continue;
    if (e.invisible) continue;
    let p; try { p = e.transformCoordToGlobal(0, 0); } catch (_) { continue; }
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) continue;
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); n++;
  }
  const z = st.zoom || 1, px = st.pxScale || 1;
  const vc = st.viewCenter || [0, 0];
  const hw = (W / 2) / (px * z), hh = (H / 2) / (px * z);
  let inView = 0;
  for (const p of vals) if (Math.abs(p.x - vc[0]) <= hw && Math.abs(p.y - vc[1]) <= hh) inView++;
  // 高亮集合在世界坐标里的跨度，以及它此刻在**屏幕上**占多大
  let hlN = 0, hlPx = 0;
  if (st.hlNodes && st.hlNodes.size) {
    let a = Infinity, b = -Infinity, c2 = Infinity, d2 = -Infinity;
    for (const id of st.hlNodes) {
      const p = st.pos.get(id);
      if (!p) continue;
      hlN++;
      a = Math.min(a, p.x); b = Math.max(b, p.x); c2 = Math.min(c2, p.y); d2 = Math.max(d2, p.y);
    }
    if (hlN) hlPx = Math.max(b - a, d2 - c2) * (px / (Math.abs(st.fitLast) || 1)) * z;
  }
  return {
    view: st.view, zoom: +z.toFixed(3), W, H, n, nNodes, inView, hlN, hlPx,
    inkW: maxX - minX, inkH: maxY - minY,
    // pxScale 是「每个「适配前」世界单位多少像素」，ECharts 的 cs.scaleX 是「每个「适配后」单位多少像素」
    // ⇒ 两者要除以 fitLast 才可比。留 12% 余量：ECharts 的包围盒会把节点半径也算进去。
    scaleErrPct: cs ? +(Math.abs((cs.scaleX * (st.fitLast || 1)) - px) / Math.max(1e-9, px) * 100).toFixed(2) : null,
    pxScale: px, fitLast: st.fitLast,
  };
})()`);

const goto = async (slug, minChars) => {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=${slug}` });
  for (let i = 0; i < 300; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length>=${minChars})`).catch(() => false)) break;
    await wait(100);
  }
  await wait(2200);
  await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`).catch(() => {});
  await wait(1200);
};
const setView = async (v) => { await js(`document.querySelector('[data-view="${v}"]').click()`); await wait(4000); };

try {
  await send('Page.enable'); await send('Runtime.enable');

  /* ============ ① 三个视图下 pxScale 都必须等于 ECharts 真实的尺度 ============ */
  console.log('\n▶ ① state.pxScale ＝ ECharts 真实尺度（十二万分支/三国 871 人）');
  await goto('three-kingdoms', 500);
  for (const v of ['gen-v', 'gen-h', 'force']) {
    if (v === 'force') {
      // 力导向是异步迭代的，等它稳定
      await setView(v); await wait(9000);
    } else {
      await setView(v);
    }
    const p = await probe();
    ok(p.scaleErrPct !== null && p.scaleErrPct <= 12,
      `${v.padEnd(6)} 解析式 vs ECharts 实测 差 ${p.scaleErrPct}%（pxScale=${p.pxScale.toFixed(5)}）`);
  }

  /* ============ ② 「横」视图要铺开画布宽度 ============ */
  console.log('\n▶ ② 分组·横：群组轴必须铺开画布（坏掉时只有 7%）');
  await setView('gen-h');
  const gh = await probe();
  const wPct = gh.inkW / gh.W * 100;
  console.log(`    墨迹 ${Math.round(gh.inkW)}×${Math.round(gh.inkH)} / 画布 ${gh.W}×${gh.H} → ${wPct.toFixed(0)}% 宽 × ${(gh.inkH / gh.H * 100).toFixed(0)}% 高`);
  ok(wPct >= 55, `横向铺开 ${wPct.toFixed(0)}%（下限 55%，修复前 7%）`);
  ok(gh.inkH / gh.H * 100 >= 40, `纵向铺开 ${(gh.inkH / gh.H * 100).toFixed(0)}%（下限 40%，修复前 80% 但横向塌了）`);

  /* ============ ③ 连点若干人 + 中间反复缩放，不会变空白 ============ */
  console.log('\n▶ ③ 连点 5 个人（不连续）+ 每次中间缩放一次，任何一步都不能空');
  const picks = await js(`(() => {
    const st = window.__ba.state;
    const arr = st.book.characters.filter(c => st.pos.has(c.id))
      .map(c => ({ id: c.id, name: c.name, deg: (st.adj.get(c.id) || []).length }))
      .sort((a, b) => a.deg - b.deg);
    return [arr[0], arr[Math.floor(arr.length * 0.2)], arr[Math.floor(arr.length * 0.5)],
            arr[Math.floor(arr.length * 0.85)], arr[arr.length - 1]]
      .map(p => ({ id: p.id, name: p.name, deg: p.deg }));
  })()`);
  for (const view of ['gen-h', 'gen-v']) {
    await setView(view);
    let worst = 1;
    let worstAt = '';
    const detail = [];
    for (const [i, p] of picks.entries()) {
      // 先量「点完他、focusViewOn 刚动完视野」那一刻 —— 原来的 bug 就发生在这里：
      // target 把 zoom 当像素尺度算，差一个等比适配系数 ⇒ 视野被怼到没有节点的地方。
      await js(`window.__ba.selectCharacter(${JSON.stringify(p.id)})`);
      await wait(800);
      const afterClick = await probe();
      const f1 = afterClick.inView / Math.max(1, afterClick.nNodes);
      if (f1 < worst) { worst = f1; worstAt = `点${p.name}后`; }
      detail.push(`${p.name}:点后${(f1 * 100).toFixed(0)}%`);
      if (f1 < 0.05) break;
      // 再叠一次缩放（用户"中间也放大缩小画布几次"）
      await js(`window.__ba.applyZoom(${i % 2 ? 2.6 : 0.45}, [${(i * 61) % 400 - 200}, ${(i * 43) % 300 - 150}])`);
      await wait(700);
      const s = await probe();
      const f2 = s.inView / Math.max(1, s.nNodes);
      if (f2 < worst) { worst = f2; worstAt = `缩放到${s.zoom}×后`; }
      detail[detail.length - 1] += `→${s.zoom}×${(f2 * 100).toFixed(0)}%`;
      if (f2 < 0.05) break;
    }
    ok(worst >= 0.05, `${view.padEnd(6)} 最低可见 ${(worst * 100).toFixed(0)}%（下限 5%，出现在${worstAt}）｜${detail.join('  ')}`);
  }

  /* ============ ④ 点一个人之后，高亮那一小撮在屏幕上要够大 ============ */
  /* 这是「点得动、看得清」的行为保证。注意它**不是** unitPx 那行的专属护栏：
   * 布局修好之后 unitPx 恒等于 0.95～1.1（ECharts 的等比适配系数只在这个区间晃），
   * 把它当成 1 的老写法只差 10%，本条抓不住。真正守住尺度的是 ① ——
   * 只要 pxScale 还对，focusViewOn 的换算就不会错。 */
  console.log('\n▶ ④ 点一个人之后，高亮那一小撮在屏幕上够大');
  await goto('one-hundred-years-of-solitude', 20);
  for (const v of ['gen-v', 'gen-h']) {
    await setView(v);
    // 找一个"关系多"的人物，高亮集合才有非零跨度
    const who = await js(`(() => {
      const st = window.__ba.state;
      const arr = st.book.characters.filter(c => st.pos.has(c.id))
        .map(c => ({ id: c.id, deg: (st.adj.get(c.id) || []).length }))
        .sort((a, b) => b.deg - a.deg);
      return arr[0].id;
    })()`);
    await js(`window.__ba.selectCharacter(${JSON.stringify(who)})`);
    await wait(900);
    const p = await probe();
    const unitPx = p.pxScale / p.fitLast;
    const want = Math.min(p.W, p.H) * 0.25;
    console.log(`    ${v.padEnd(6)} unitPx=${unitPx.toFixed(2)} 高亮 ${p.hlN} 人 → 屏幕上 ${Math.round(p.hlPx)}px（想要 ≥${Math.round(want)}px）`);
    ok(p.hlN === 0 || p.hlPx >= want,
      `${v.padEnd(6)} 高亮占画布短边 ${(p.hlPx / Math.min(p.W, p.H) * 100).toFixed(0)}%（下限 25%）`);
  }

  /* ============ ⑤ 小书：允许看着空，但不能崩、尺度仍然要对 ============ */
  console.log('\n▶ ⑤ 小书（百年孤独）：尺度公式照样成立');
  await goto('one-hundred-years-of-solitude', 20);
  for (const v of ['gen-v', 'gen-h']) {
    await setView(v);
    const p = await probe();
    ok(isFinite(p.pxScale) && p.pxScale > 0 && p.scaleErrPct <= 12,
      `${v.padEnd(6)} pxScale=${p.pxScale.toFixed(5)} 误差 ${p.scaleErrPct}%（${p.nNodes} 人）`);
    ok(Number.isFinite(p.inkW) && Number.isFinite(p.inkH), `${v.padEnd(6)} 坐标全有限`);
  }

  console.log(`\n${failed ? '✗' : '✓'} render-scale：${passed} 通过，${failed} 失败`);
} catch (e) {
  failed++; console.error('异常：' + e.message);
} finally {
  try { ws.close(); } catch { }
  try { proc.kill(); } catch { }
  try { server.close(); } catch { }
  releaseProfile(profile);
}
process.exit(failed ? 1 : 0);