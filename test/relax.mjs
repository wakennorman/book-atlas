import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';
import { requireBrowser } from './_browser.mjs';

// 「没有坐标的人怎么落位」的两条性质（v87 加）：
//   ① 孤立人物（一条关系都没有）不能叠在同一个点上
//      旧实现把所有这类人一律放到全局重心 ⇒ 三国的 35 个零关系人物全部重合，
//      永远分不开（坐标完全相同时 dx=dy=0，位移永远是 0）。
//   ② 即使真的喂进一批完全重合的坐标，relaxPositions 也必须能把它们分开，
//      而且不能产生 NaN/Infinity。
//
// 用法：node test/relax.mjs
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 0;   // v0.97：临时端口，listen 之后回填
const CDP_PORT = await freePort();
const EDGE = requireBrowser();

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon' };
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-relax3-'));
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

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
  for (let i = 0; i < 240; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length>500)`).catch(() => false)) break;
    await wait(100);
  }
  await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`);
  await wait(2000);

  // 两个探针：数"坐标完全相同的组"、数"距离 < 12 的重叠对"
  await js(`window.__probe = () => {
    const st = window.__ba.state;
    const m = new Map();
    for (const [id, p] of st.pos) { const k = p.x + ',' + p.y; if (!m.has(k)) m.set(k, []); m.get(k).push(id); }
    const groups = [...m.values()].filter((g) => g.length > 1);
    const a = [...st.pos.values()];
    let overlap = 0, finite = true;
    for (const p of a) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) finite = false;
    for (let i = 0; i < a.length; i++) for (let j = i+1; j < a.length; j++) {
      const dx = a[j].x - a[i].x, dy = a[j].y - a[i].y;
      if (dx*dx + dy*dy < 12*12) overlap++;
    }
    return { coincident: groups.length, worst: groups.reduce((a, g) => Math.max(a, g.length), 0), overlap, finite, n: a.length };
  }`);

  /* ---- ① 零关系人物不能叠在同一个点上 ----
   *
   * ⚠ v0.118 改过：原来断言 `orphan >= 30`，靠**真实数据里恰好有 35 个孤立人物**当输入。
   *   v0.118 把那 35 个人都连上了（补了 39 条边），三国只剩 **1 个**孤立人物
   *   （裴绪 —— 原文明说他是孔明心腹假扮的，不该连），断言随之失败。
   *
   * 这条测试要验的是**落位算法**的性质（孤立人物不能全叠在重心），
   * 不是"数据里恰好有多少孤立人物"。让真实数据的数量决定测试成败，
   * 等于把算法的正确性绑在一个会随数据变动的计数上 ——
   * 下次再补几条边，同一个测试又会红，而算法一点问题都没有。
   *
   * ⇒ 改成**自己造** 40 个孤立人物：性质照样验，且不再受数据变动影响。
   *   真实数据里剩几个（当前 1 个）只作为附带信息打印，不参与判定。
   */
  console.log('\n▶ ① 零关系人物不能叠在同一个点上');
  const iso = await js(`(() => {
    const st = window.__ba.state;
    const deg = new Set();
    for (const r of st.book.relations) { deg.add(r.from); deg.add(r.to); }
    const realOrphan = st.book.characters.filter((c) => !deg.has(c.id)).map((c) => c.id);

    /* 造 40 个真的没有一条关系的人物，并从关系里排除（保证它们确属"零关系"） */
    const N = 40;
    const fake = [];
    for (let i = 0; i < N; i++) {
      const id = '__probe_orphan_' + i;
      st.book.characters.push({ id, name: '探针孤儿' + i, aliases: [], generation: 1, gender: 'm' });
      fake.push(id);
    }
    const orphan = realOrphan.concat(fake);
    for (const id of orphan) st.pos.delete(id);

    // 先算出「旧实现会放成什么样」：全部丢到同一个全局重心 ⇒ 必然全部重合
    let cx = 0, cy = 0, n = 0;
    for (const p of st.pos.values()) { cx += p.x; cy += p.y; n++; }
    cx /= (n || 1); cy /= (n || 1);
    const oldWould = new Set(orphan.map(() => cx + ',' + cy)).size;
    window.__ba._fillMissing();

    const after = window.__probe();
    // 还原现场，别把探针人物漏给后面的用例
    st.book.characters = st.book.characters.filter((c) => !c.id.startsWith('__probe_orphan_'));
    for (const id of orphan) st.pos.delete(id);
    return { real: realOrphan.length, orphan: orphan.length, oldWould, after };
  })()`);
  ok(iso.orphan >= 40, `造了 ${iso.orphan} 个零关系人物（其中真实数据 ${iso.real} 个 + 探针 40 个）`);
  ok(iso.oldWould === 1,
    `旧实现会把它们全放到同一个重心 ⇒ ${iso.orphan} 个人共用 ${iso.oldWould} 个坐标`);
  ok(iso.after.coincident === 0,
    `现在的实现补完后没有"坐标完全相同"的组`);
  ok(iso.after.finite, '补出来的坐标都是有限数');

  /* ---- ② 完全重合的坐标必须能被 relaxPositions 分开 ---- */
  console.log('\n▶ ② 完全重合的坐标必须能分开（relaxPositions 的兜底）');
  const deg = await js(`(() => {
    const ba = window.__ba, st = ba.state;
    const save = new Map([...st.pos].map(([k, v]) => [k, { x: v.x, y: v.y }]));
    for (const p of st.pos.values()) { p.x = 0; p.y = 0; }
    const before = window.__probe();
    const t0 = performance.now();
    ba._relaxPositions(140);
    const ms = +(performance.now() - t0).toFixed(1);
    const after = window.__probe();
    for (const [k, v] of save) { const p = st.pos.get(k); if (p) { p.x = v.x; p.y = v.y; } }
    return { before, after, ms };
  })()`);
  ok(deg.before.coincident === 1 && deg.before.worst === deg.before.n,
    `退化输入：${deg.before.n} 个节点全部落在 (0,0)`);
  ok(deg.after.coincident === 0, `松弛 ${deg.ms} ms 后不再有完全重合的点`);
  ok(deg.after.finite, '没有产生 NaN/Infinity（旧实现这里 dx=dy=0 位移恒为 0，永远分不开）');

  /* ---- ③ 打乱坐标后仍能收敛 ---- */
  console.log('\n▶ ③ 常规路径：打乱坐标后仍能收敛到无重叠');
  const scram = await js(`(() => {
    const ba = window.__ba, st = ba.state;
    let s = 12345;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (const p of st.pos.values()) { p.x = rnd() * 400 - 200; p.y = rnd() * 400 - 200; }
    const before = window.__probe();
    const t0 = performance.now();
    ba._relaxPositions(140);
    const ms = +(performance.now() - t0).toFixed(1);
    return { before, after: window.__probe(), ms };
  })()`);
  ok(scram.before.overlap > 0, `打乱后制造出 ${scram.before.overlap} 对重叠`);
  ok(scram.after.overlap === 0, `松弛 140 轮（${scram.ms} ms）后重叠 ${scram.before.overlap} → ${scram.after.overlap}`);

} catch (e) {
  failed++;
  console.error('  ✗ 异常：' + e.message);
} finally {
  try { ws.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  releaseProfile(profile);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`落位与防重叠　通过：${passed}  失败：${failed}`);
process.exit(failed > 0 ? 1 : 0);