import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';
import { requireBrowser } from './_browser.mjs';

// 同一对人物之间可能有**类型完全相同**的多条关系 —— 图上会画成多条线（不同曲率），
// 但只靠 (source, target, value=类型) 分不开它们。
// 实测刘备—诸葛亮有两条「君臣军师」（第40章、第49章）：旧实现里第二条线永远被解析成
// 第一条，于是悬停第49章那条线弹出来的是第40章的内容、点它打开的也是第40章那张卡 ——
// 用户看到的就是"这条线点了没反应"（其实有反应，只是响应的是旁边那条线）。
//
// 这里守住：图上每条线都必须能被解析回**它自己**那条关系。
// 用法：node test/relations.mjs
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-rel-'));
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
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));  /* v0.115：CDP 响应不来时 pending 条目永不 settle ⇒ 静默挂死。 */ setTimeout(() => { if (pending.delete(id)) reject(new Error(method + ' 30 秒无响应')); }, 30000);});
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await send('Page.enable'); await send('Runtime.enable');

  /* ---------- 1) 纯数据检查：歧义确实存在（否则下面的断言就没意义） ---------- */
  const books = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'books.json'), 'utf8')).books
    .filter((b) => b.file || b.graphFile);
  let totalAmb = 0;
  const ambList = [];
  for (const bk of books) {
    const file = bk.file || path.join('data', path.basename(bk.graphFile).replace('.graph.json', '.json'));
    const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
    if (!fs.existsSync(abs)) continue;
    const book = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const names = new Map((book.characters || []).map((c) => [c.id, c.name]));
    const key = new Map();
    for (const r of book.relations || []) {
      const k = [r.from, r.to].sort().join('|') + '\u0000' + r.type;
      key.set(k, (key.get(k) || 0) + 1);
    }
    for (const [k, n] of key) {
      if (n <= 1) continue;
      totalAmb += n - 1;
      const [pair, type] = k.split('\u0000');
      const [a, c] = pair.split('|');
      ambList.push(`${names.get(a) || a}—${names.get(c) || c}「${type}」×${n}`);
    }
  }
  console.log(`\n▶ 数据里「同一对 + 同一类型」的多条关系：共 ${totalAmb} 处`);
  console.log('  ' + ambList.slice(0, 6).join('\n  ') + (ambList.length > 6 ? `\n  …另外 ${ambList.length - 6} 处` : ''));
  ok(totalAmb > 0, `确认这种歧义在数据里真实存在（${totalAmb} 处）—— 不是假想输入`);

  /* ---------- 2) 图上每条线都要能解析回它自己 ---------- */
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
  for (let i = 0; i < 240; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length>500)`).catch(() => false)) break;
    await wait(100);
  }
  await wait(2000);
  await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`);
  await wait(2000);

  const check = await js(`(() => {
    const ba = window.__ba, st = ba.state, ch = ba.chart();
    const links = ch.getOption().series[0].links || [];
    const rels = st.book.relations;
    const missingBaRel = [];
    const wrongNew = [];      // 带下标（新行为）解析错的
    const wrongOld = [];      // 不带下标（旧行为）解析错的 —— 应当 > 0，否则说明测试没打到点上
    let checked = 0;

    links.forEach((l, i) => {
      if (typeof l.baRel !== 'number') { missingBaRel.push(i); return; }
      const want = rels[l.baRel];
      if (!want || ((want.from !== l.source || want.to !== l.target) && (want.from !== l.target || want.to !== l.source))) {
        missingBaRel.push(i); return;   // baRel 指到的不是这一对，不算歧义用例，跳过
      }
      checked++;
      const gotNew = ba._findRel(l.source, l.target, l.value, l.baRel);
      if (!gotNew || rels.indexOf(gotNew) !== l.baRel) wrongNew.push({ i, type: l.value, baRel: l.baRel, got: gotNew ? rels.indexOf(gotNew) : -1 });
      const gotOld = ba._findRel(l.source, l.target, l.value);
      if (!gotOld || rels.indexOf(gotOld) !== l.baRel) wrongOld.push({ i, type: l.value, baRel: l.baRel, got: gotOld ? rels.indexOf(gotOld) : -1 });
    });
    return { totalLinks: links.length, checked, missingBaRel: missingBaRel.length, wrongNew, wrongOld };
  })()`);

  ok(check.missingBaRel === 0, `每条线都带上了 baRel（${check.totalLinks} 条线，缺失 ${check.missingBaRel} 条）`);
  ok(check.wrongOld.length > 0,
    `旧行为确实会解析错（${check.wrongOld.length} 条）—— 证明这个测试打在了真问题上`);
  ok(check.wrongNew.length === 0,
    `新行为全部解析正确（检查了 ${check.checked} 条，解析错 ${check.wrongNew.length} 条）`);
  if (check.wrongNew.length) console.error('    明细：' + JSON.stringify(check.wrongNew));
  if (check.wrongOld.length) {
    console.log('    旧行为错的几条：' + JSON.stringify(check.wrongOld.slice(0, 4)));
  }

/* ================= v0.97 连线扇形：同一个点连出去的线不能叠在一起 =================
   *
   * 用户报的现象：拖动节点到某处后，连到它上面的关系线重叠、间距太小，鼠标不好悬浮和点击。
   *
   * 病根：ECharts 的图连线一律从节点**中心**出发，曲率只决定往哪一侧弯、弯多少。
   * 原来的 pairSeen 曲率只按"同一**对**人物"分组，于是从某个枢纽连出去的 N 条线
   * 曲率**全都是同一个 0.08** —— 那只是把所有线**平移了同一个出发方位角**，
   * 一条也没互相分开。于是挤不挤完全取决于邻居方向本身：把节点拖到一边、
   * 邻居全落到同一侧，相邻方位角能小到 0.0x 度，线就几乎平行地贴着走。
   *
   * 度量口径（与 js/app.js 的 computeEdgeFan 注释同一套公式，已对着
   * vendor/echarts.min.js 里 `_A` 的控制点实测验证过）：
   *     线在**出发端**的方位角 = 直线方位角 − atan(2c)，在**到达端** = 直线方位角 + atan(2c)
   * 取一个节点所有出线的**最小相邻夹角** —— 夹角 0 就是"完全重叠"。
   */
  /* ⚠ 对照组的"旧行为"要照**旧代码真实的样子**取：曲率一律 0.08。
   * 不是取 0 —— 因为旧代码里"只有一条关系的一对"拿到的正是 0.08，
   * 而 source/target 混在一起时，这个恒定值本身就会把线错开一点。
   * 取 0 的话，即便把扇形整个删掉测试也照样绿（第一版栽在这：4 条线里方向混着，
   * 最小夹角还有 7.96°，看着像过了，其实测的是那点偶然的错开）。 */
  const fanMeasure = (id, useCv) => js(`(() => {
    const ba = window.__ba, ch = ba.chart();
    const links = ch.getOption().series[0].links || [];
    /* 位置一律取**系列数据里当下**的坐标，而不是 state.pos：
     * 曲率是 ECharts 渲染时配着这份坐标用的；节点拖完之后新坐标先落在数据里
     * （要等 refreshEdgeFan 才写回 state.pos）。读 state.pos 就量不到"拖完还没重算"那一刻。 */
    const data = ch.getModel().getSeriesByIndex(0).getData();
    const pos = new Map();
    for (let k = 0; k < data.count(); k++) {
      const key = data.getId(k);
      if (!key || String(key).startsWith('__gen_')) continue;
      const lay = data.getItemLayout(k);
      if (lay) pos.set(key, { x: lay[0] ?? lay.x, y: lay[1] ?? lay.y });
    }
    const ds = [];
    for (const l of links) {
      const isTarget = l.target === ${JSON.stringify(id)};
      const isSource = l.source === ${JSON.stringify(id)};
      if (!isTarget && !isSource) continue;
      const other = isSource ? l.target : l.source;
      const a = pos.get(${JSON.stringify(id)}), b = pos.get(other);
      if (!a || !b) continue;
      const c = ${useCv ? "(l.lineStyle && typeof l.lineStyle.curveness === 'number') ? l.lineStyle.curveness : 0" : '0.08'};
      const straight = Math.atan2(b.y - a.y, b.x - a.x);
      ds.push(straight + (isTarget ? 1 : -1) * Math.atan(2 * c));
    }
    if (ds.length < 2) return null;
    const norm = (x) => { let v = x % (Math.PI * 2); if (v < 0) v += Math.PI * 2; return v; };
    const s = ds.map(norm).sort((p, q) => p - q);
    const gaps = [];
    for (let i = 1; i < s.length; i++) gaps.push(s[i] - s[i - 1]);
    gaps.push(s[0] + Math.PI * 2 - s[s.length - 1]);
    const sorted = gaps.slice().sort((p, q) => p - q);
    return {
      n: ds.length,
      minGapDeg: +(Math.min.apply(null, gaps) * 180 / Math.PI).toFixed(2),
      medGapDeg: +(sorted[Math.floor(sorted.length / 2)] * 180 / Math.PI).toFixed(2),
    };
  })()`);

  console.log('\n▶ v0.97 连线扇形：同一个点的出线按邻居方位角岔开');
  const fanTarget = await js(`(() => {
    const ba = window.__ba, st = ba.state;
    const links = ba.chart().getOption().series[0].links || [];
    const nb = new Map();
    for (const l of links) {
      for (const pair of [[l.source, l.target, false], [l.target, l.source, true]]) {
        let arr = nb.get(pair[0]);
        if (!arr) nb.set(pair[0], (arr = []));
        arr.push({ other: pair[1], isTarget: pair[2] });
      }
    }
    const minGap = (id) => {
      /* 曲率一律按 0.08 算 —— 也就是**旧代码**给"只有一条关系的一对"的值。
       * 0.08 是所有出线**共同**的恒定偏移，只能整体旋转、分开不了一条线，
       * 所以这里量出来的夹角就是旧代码的真实表现。 */
      const arr = nb.get(id) || [];
      const ds = [];
      for (const e of arr) {
        const a = st.pos.get(id), b = st.pos.get(e.other);
        if (!a || !b) continue;
        const straight = Math.atan2(b.y - a.y, b.x - a.x);
        ds.push(straight + (e.isTarget ? 1 : -1) * Math.atan(2 * 0.08));
      }
      if (ds.length < 2) return null;
      const norm = (x) => { let v = x % (Math.PI * 2); if (v < 0) v += Math.PI * 2; return v; };
      const s = ds.map(norm).sort((p, q) => p - q);
      const g = [];
      for (let i = 1; i < s.length; i++) g.push(s[i] - s[i - 1]);
      g.push(s[0] + Math.PI * 2 - s[s.length - 1]);
      return Math.min.apply(null, g) * 180 / Math.PI;
    };
    // 挑「**本来就挤**」的那个：度数 3~6（这个区间扇形能把夹角做到设计值），
    // 且不算扇形时最小夹角最小。随机挑会挑到邻居本来就散开的节点，
    // 那样测出来的「重叠」是 0，测试就打偏了（第一版栽在这）。
    let best = null;
    for (const [id, arr] of nb) {
      if (arr.length < 3 || arr.length > 6) continue;
      const g = minGap(id);
      if (g === null) continue;
      if (!best || g < best.g) best = { id, deg: arr.length, g: +g.toFixed(2) };
    }
    return best;
  })()`);
  ok(!!fanTarget && fanTarget.g < 1.0,
    `找得到一个「本来就挤」的节点（${fanTarget && fanTarget.id}，${fanTarget && fanTarget.deg} 条线，不算扇形时最小夹角 ${fanTarget && fanTarget.g}°）`);
  ok(!!fanTarget, `候选：度数 3~6`);

  if (fanTarget) {
    const { id } = fanTarget;
    const withFan = await fanMeasure(id, true);
    const without = await fanMeasure(id, false);
    console.log(`    「${id}」${withFan.n} 条出线：最小夹角 ${without.minGapDeg}° → ${withFan.minGapDeg}°（中位 ${without.medGapDeg}° → ${withFan.medGapDeg}°）`);
    ok(without.minGapDeg < 1.0,
      `对照组：不算扇形时最小夹角只有 ${without.minGapDeg}°（≈完全重叠）—— 证明这个测试打在了真问题上`);
    ok(withFan.minGapDeg >= 3.0,
      `算上扇形后最小夹角 ${withFan.minGapDeg}° ≥ 3°（设计目标 4°，留一点余量给另一端的贡献）`);

    /* 拖完之后必须重算：曲率是**烤进 option** 的，而 ECharts 渲染时才拿它配**当下的**坐标。
     * 不重算的话，线就是"拖之前的曲率 ＋ 拖之后的坐标"——扇形整个作废。 */
    console.log('\n▶ v0.97 拖动节点之后：坐标写回并重算扇形');
    const dragged = await js(`(() => {
      const ba = window.__ba, st = ba.state, ch = ba.chart();
      const links = ch.getOption().series[0].links || [];
      const nb = [];
      for (const l of links) {
        if (l.source === ${JSON.stringify(id)}) nb.push(l.target);
        else if (l.target === ${JSON.stringify(id)}) nb.push(l.source);
      }
      const a = st.pos.get(${JSON.stringify(id)});
      // 朝邻居重心**再往前**拖一大段 —— 这才是把节点"拖出来到某一处"的典型情形：
      // 所有邻居随之挤到同一侧，方位角差被压到接近 0。
      let cx = 0, cy = 0, got = 0;
      for (const o of nb) {
        const p = st.pos.get(o);
        if (!p) continue;
        cx += p.x; cy += p.y; got++;
      }
      cx /= got; cy /= got;
      let dx = cx - a.x, dy = cy - a.y;
      if (Math.hypot(dx, dy) < 1e-6) { const p0 = st.pos.get(nb[0]); dx = (p0 ? p0.x : 1) - a.x; dy = (p0 ? p0.y : 0) - a.y; }
      const L = Math.hypot(dx, dy) || 1;
      const far = [a.x + (dx / L) * Math.max(500, L * 12), a.y + (dy / L) * Math.max(500, L * 12)];
      const ser = ch.getModel().getSeriesByIndex(0);
      const data = ser.getData();
      let i = -1;
      for (let k = 0; k < data.count(); k++) if (data.getId(k) === ${JSON.stringify(id)}) { i = k; break; }
      if (i < 0) return { err: 'not in series' };
      const before = data.getItemLayout(i).slice();
      data.setItemLayout(i, far);      // ECharts 拖完节点之后就是这样把新坐标留在数据里的
      ch.getZr().flush();
      return { before: before.map(Math.round), far: far.map(Math.round), nb: nb.length };
    })()`);
    ok(!dragged.err, `模拟把节点拖离邻居簇（${dragged.nb} 个邻居）：${dragged.before} → ${dragged.far}`);

    const stale = await fanMeasure(id, true);
    ok(stale.minGapDeg < withFan.minGapDeg,
      `不重算的话，拖完最小夹角从 ${withFan.minGapDeg}° 掉到 ${stale.minGapDeg}° —— 曲率是按拖之前的位置算的`);

    const redone = await js(`(() => {
      // 走**真实的**触发路径：开着「拖动节点」模式，然后在画布上派发一次 mouseup
      //（app.js 里的 endPanning → refreshEdgeFan）。
      // 直接调内部函数会漏掉这根接线 —— 那样把 endPanning 删了测试照样绿。
      window.__ba.state.nodeDrag = true;
      const zr = window.__ba.chart().getZr();
      zr.handler.dispatch('mouseup', { zrX: 12, zrY: 12, target: null, offsetX: 12, offsetY: 12 });
      return true;
    })()`);
    await wait(1200);
    const after = await fanMeasure(id, true);
    const posAfter = await js(`(() => { const p = window.__ba.state.pos.get(${JSON.stringify(id)}); return [Math.round(p.x), Math.round(p.y)]; })()`);
    ok(redone === true, '派发 mouseup（开着「拖动节点」）');
    ok(Math.abs(posAfter[0] - dragged.far[0]) < 3 && Math.abs(posAfter[1] - dragged.far[1]) < 3,
      `松手后新坐标写回了 state.pos（${posAfter}，期望 ${dragged.far.map(Math.round)}）—— 松手就重算，而不是下次碰别的才补`);
    ok(after.minGapDeg >= 3.0,
      `重算后最小夹角回到 ${after.minGapDeg}° ≥ 3°（重算前 ${stale.minGapDeg}°）`);

    /* 曲率必须有上限：弯成弧就认不出谁连谁了，而且会盖掉 pairSeen 那一层 */
    const cvBounds = await js(`(() => {
      const links = window.__ba.chart().getOption().series[0].links || [];
      let lo = Infinity, hi = -Infinity, bad = 0;
      for (const l of links) {
        const c = l.lineStyle && l.lineStyle.curveness;
        if (typeof c !== 'number' || !Number.isFinite(c)) { bad++; continue; }
        if (c < lo) lo = c;
        if (c > hi) hi = c;
      }
      return { lo: +lo.toFixed(4), hi: +hi.toFixed(4), bad, n: links.length };
    })()`);
    ok(cvBounds.bad === 0, `每条线的 curveness 都是有限数（${cvBounds.n} 条，异常 ${cvBounds.bad}）`);
    ok(cvBounds.lo >= -0.5 && cvBounds.hi <= 0.5,
      `曲率都在 ±0.5 以内（实测 ${cvBounds.lo} ~ ${cvBounds.hi}）`);
  }

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
console.log(`关系线身份　通过：${passed}  失败：${failed}`);
process.exit(failed > 0 ? 1 : 0);