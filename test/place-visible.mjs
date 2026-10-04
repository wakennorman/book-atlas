// v93：点开地点后画布不能是空白的
//  ① 根因门禁：筛选/锁定后「世界单位→像素」的比例必须和 ECharts 真实采用的一致
//     （解析式 pxScale/fitLast 只在"画的就是全图"时准；实测筛选后会差 3.74 倍）
//  ② 每个地点单独点开，锁定的人里至少七成真的落在画布内，且画布上确实画出了东西
//
// ⚠ ②必须**每个地点重新加载页面**再点。连点会让上一次的视野残留替这一次打掩护 ——
//   这个测试的第一版就是这么写的，测出「10/10 全过」，而真实单点路径是 3/10。
//   教训和 v93 CHANGELOG §八 里那三条假绿同源：测量方法本身会骗人。
import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
server.on('error', (e) => { console.error('静态服务器起不来：' + e.message); process.exit(1); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.log('  (跳过) 找不到 Edge/Chrome'); process.exit(0); }
const CDP_PORT = await freePort();   // v0.97：不再需要 BA_CDP_SEQ 错开
sweepStaleProfiles();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-pv-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
const ws = new WebSocket(url);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); } };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 40000);
});
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

/* 独立测量：用 ECharts 公开的 convertToPixel 拿两个点的屏幕距离 ÷ 世界距离。
 * 故意不复用 app 里的任何函数 —— 复用就等于让被测对象给自己打分。
 *
 * ⚠ 这里量的是**当前 zoom 下**"一个世界单位值多少像素"，也就是 unitPxNow() 的定义。
 *   早先写成"再除掉 zoom"（拿 zoom=1 的基准值去比），于是 12/13 里那一条永远是红的：
 *   筛到少数节点后 zoom 变成 0.19，基准值和当前值本来就不是一回事。 */
const TRUE_SCALE = `(() => {
  const ch = window.__ba.chart();
  const data = ch.getOption().series[0].data || [];
  const pts = data.filter((d) => typeof d.x === 'number' && typeof d.y === 'number' && isFinite(d.x) && isFinite(d.y));
  if (pts.length < 2) return null;
  let bestDw = 0, bestDp = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i], b = pts[j];
    const dw = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(dw > 1e-6) || dw <= bestDw) continue;
    const pa = ch.convertToPixel({ seriesIndex: 0 }, [a.x, a.y]);
    const pb = ch.convertToPixel({ seriesIndex: 0 }, [b.x, b.y]);
    if (!pa || !pb || !isFinite(pa[0]) || !isFinite(pb[0])) continue;
    bestDw = dw; bestDp = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  }
  return bestDw > 0 ? +(bestDp / bestDw).toFixed(4) : null;
})()`;

/* 锁定的人里有多少真在画布内 + 画布上实际画出了多少图元 */
const VIS = `(() => {
  const st = window.__ba.state, ch = window.__ba.chart(), zr = ch.getZr();
  const W = zr.getWidth(), H = zr.getHeight();
  const ids = st.clickLock ? [...st.clickLock.nodes] : [];
  let inside = 0;
  for (const id of ids) {
    const w = st.pos.get(id); if (!w) continue;
    let px; try { px = ch.convertToPixel({ seriesIndex: 0 }, [w.x, w.y]); } catch (e) { continue; }
    if (px && px[0] >= 0 && px[0] <= W && px[1] >= 0 && px[1] <= H) inside++;
  }
  const inks = zr.storage.getDisplayList(true).filter((e) => e.type !== 'text' && !e.invisible);
  let inView = 0;
  for (const e of inks) {
    const r = e.getBoundingRect().clone(); r.applyTransform(e.transform);
    if (r.x + r.width > 0 && r.x < W && r.y + r.height > 0 && r.y < H) inView++;
  }
  return { total: ids.length, inside, drawn: inks.length, inView, zoom: +Number(st.zoom || 1).toFixed(3) };
})()`;

const loadBook = async (book) => {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=${book}` });
  for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.places.length)`).catch(() => false)) break; await wait(100); }
  await wait(2200);
  await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`).catch(() => {});
  await wait(1200);
};

const BOOKS = process.argv[2] ? [process.argv[2]] : ['one-hundred-years-of-solitude', 'crime-and-punishment'];

try {
  await send('Page.enable'); await send('Runtime.enable');

  for (const BOOK of BOOKS) {
    console.log(`\n=== 《${BOOK}》 ===`);

    /* ① 比例门禁：全图 vs 筛到只剩几个人，app 用的换算都要和真实值对得上 */
    await loadBook(BOOK);
    const trueFull = await js(TRUE_SCALE);
    const appFull = await js(`window.__ba.unitPxNow()`);
    ok(trueFull > 0, `全图：能独立量出真实比例（${trueFull}）`);
    ok(appFull > 0 && Math.abs(appFull - trueFull) / trueFull < 0.2,
      `全图：app 用的比例 ${(+appFull).toFixed(4)} ≈ 真实 ${trueFull}（偏差 ${(Math.abs(appFull - trueFull) / trueFull * 100).toFixed(1)}%）`);

    // 找一个"筛完人很少"的地点：人和全图比要少得多
    const places = await js(`window.__ba.state.book.places.map((p) => ({ id: p.id, name: p.name }))`);
    let picked = null;
    for (const p of places) {
      await js(`window.__ba.applyPlaceFilterForTest(${JSON.stringify(p.id)})`).catch(() => {});
      await wait(1400);
      const n = await js(`window.__ba.chart().getOption().series[0].data.length`);
      const full = await js(`(()=>{const st=window.__ba.state;return st.clickLock?st.clickLock.nodes.size:0})()`);
      if (n >= 2 && n <= Math.max(3, Math.round((await js(`window.__ba.state.book.characters.length`)) * 0.2)) && full > 0) { picked = { p, n, full }; break; }
      await js(`window.__ba.applyPlaceFilterForTest(null)`).catch(() => {});
      await wait(900);
    }
    if (!picked) { ok(false, '找得到一个"筛完只剩少数人"的地点来验比例'); continue; }
    const trueFiltered = await js(TRUE_SCALE);
    const appFiltered = await js(`window.__ba.unitPxNow()`);
    ok(trueFiltered > 0, `筛到「${picked.p.name}」只剩 ${picked.n} 个点时：真实比例 ${trueFiltered}（此刻 zoom=${await js('window.__ba.state.zoom')}）`);
    // 这一条就是病根门禁：v92 的解析式在这种情况下偏差 80%+，而且方向正好相反 ——
    // 代码以为一个单位只有 0.2 像素（其实 1.43），于是"人在画面里"和"放大能救"两个判断同时反掉。
    const modelled = ((await js(`(window.__ba.state.pxScale||1)/(Math.abs(window.__ba.state.fitLast)||1)`)) * (await js('window.__ba.state.zoom')));
    ok(appFiltered > 0 && Math.abs(appFiltered - trueFiltered) / trueFiltered < 0.2,
      `筛后：app 用的比例 ${(+appFiltered).toFixed(4)} ≈ 真实 ${trueFiltered}（偏差 ${(Math.abs(appFiltered - trueFiltered) / trueFiltered * 100).toFixed(1)}%；解析式推算会给 ${(+modelled).toFixed(4)}，偏 ${(Math.abs(modelled - trueFiltered) / trueFiltered * 100).toFixed(0)}%）`);

    /* ② 每个地点单独开一遍页面点开，看锁定的人有没有真在画面里 */
    for (const p of places) {
      await loadBook(BOOK);
      await js(`window.__ba.applyPlaceFilterForTest(${JSON.stringify(p.id)})`).catch(() => {});
      await wait(1700);
      // ⚠ 必须在**点完之后**问 placeScope()：它读的是 state.placeFilter，
      //    点击前 placeFilter 还是 null ⇒ 返回 null ⇒ 会被误判成"这个地点没有人物"（第一版就栽在这）。
      const scopeN = (await js(`(window.__ba.placeScope() || []).length`));
      if (scopeN === 0) {
        // 规则：范围为空不许静默。必须明确告诉用户，且**不能**留下一个空锁/空高亮。
        const r = await js(`(() => ({
          toastText: (document.querySelector('#ba-toast') || {}).textContent || '',
          hl: window.__ba.state.hlNodes.size,
          lock: window.__ba.state.clickLock ? window.__ba.state.clickLock.nodes.size : 0,
        }))()`);
        ok(/还没有关联的人物或事件/.test(r.toastText) && r.lock === 0,
          `点「${p.name}」：没有关联人物 ⇒ 明确提示了（"${(r.toastText || '').trim().slice(0, 24)}…"），没有留下空锁（lock=${r.lock}）`);
        continue;
      }
      const m = await js(VIS);
      const ratio = m.total ? m.inside / m.total : -1;
      ok(m.total > 0 && ratio >= 0.7 && m.inView > 0,
        `点「${p.name}」：锁定 ${m.total} 人，${m.inside} 人在画布内（${(ratio * 100).toFixed(0)}%），画面可见图元 ${m.inView} 个，zoom ${m.zoom}`);
    }
  }
} catch (e) { console.error('异常：' + e.message); failed++; }
finally {
  try { ws.close(); } catch { } try { proc.kill(); } catch { } try { server.close(); } catch { }
  releaseProfile(profile);
}

console.log(`\n通过 ${passed} · 失败 ${failed}`);
process.exit(failed ? 1 : 0);