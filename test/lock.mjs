import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';
import { requireBrowser } from './_browser.mjs';

// v89：锁定（搜索单个人物 / 两人关系）时图上**只画**锁定集合内的点与线。
// 起因：原先集合外的元素只是 opacity 调低继续画着，也没有 silent，而 zrender 的命中测试
// 不看 opacity —— 后画的淡线会把鼠标事件吃掉（三国实测"大多数线点不动、偶尔能点"）。
//
// 守住：① 系列里不含锁定集合外的元素 ② 跳数控件能改集合且有上限
//      ③ 解除后完整还原（点数/线数逐位相同、坐标逐位还原）
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-lock-'));
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
 * （同一模式在另外 15 个测试文件里也有，这次先修我改到的这个。）
 */
if (!url) {
  console.error(`  ✗ Edge 起来后 10 秒内没在 ${CDP_PORT} 上暴露 CDP 端点。`);
  console.error('    多半是刚借到的临时端口被别的进程抢走了（借出到 Edge 抢占之间有个毫秒级窗口，');
  console.error('    见 test/_free-port.mjs 的说明）—— 重跑一次通常就好。');
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  releaseProfile(profile);
  process.exit(1);
}

const ws = new WebSocket(url);
await Promise.race([
  new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }),
  new Promise((_, rej) => setTimeout(() => rej(new Error(`CDP WebSocket 10 秒内没连上（${CDP_PORT}）`)), 10000)),
]);
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); } };
/**
 * 每条 CDP 命令都带硬超时。
 *
 * ⚠ 为什么要按命令类型分开（v0.115 实测）
 *   一开始统一 30 秒，门禁里 `Input.dispatchMouseEvent` 稳定超时。**不是不应答** ——
 *   单独跑能过（92 秒、67 过 0 挂），但在跑满 31 步的机器上超过 120 秒。
 *   而应用侧的 `setOption` 只有 21.7ms（锁定）/ 64.3ms（未锁定），
 *   所以这个耗时**不在我们的代码里**。
 *
 *   两个还没排除的可能（本轮没 budget 定位，如实记在这里）：
 *     ① CDP 的 input 命令要等渲染进程确认，main thread 忙时会在队列里排队
 *     ② headless=new 下没有可见帧，合成器可能节流到帧节奏
 *   两者都与机器负载相关，所以独立跑快、门禁里慢 —— 这与实测吻合。
 *
 * ⇒ `Input.*` 给 300 秒（覆盖门禁里实测的最坏值），其余 30 秒
 *   （纯读状态的命令超时就该立刻红掉，不该干等）。
 *
 * ★ v0.121 定位了（一次性探针 test/_probe-cdp.mjs，用完即删）：
 *   同会话内交替发两类命令，结果 ——
 *     Runtime.evaluate          0–2 ms
 *     Input.*（点**空白处**）   1–7 ms
 *     Input.*（点**真实图元**） 1–3 ms
 *     而**应用侧** selectCharacter 同步耗时：163 ms
 *
 *   ⇒ **CDP 本身没有任何固有开销**（两个假设①input 队列、②合成器节流都不成立：
 *     空白处与真实图元都是毫秒级，没有"排队等帧"的迹象）。
 *     真正慢的是**应用侧那段同步工作** —— 点击 → selectCharacter →
 *     navToPanel（滚动）+ 高亮 + setOption，全程同步跑在输入事件处理器里。
 *     CDP 看到的耗时 = 这段工作 × 当下负载放大。
 *
 *   这解释了原来那条观察的悖论：
 *     「应用侧 setOption 只有 21.7ms」量的是**渲染耗时**，
 *     「门禁里 Input 超 120 秒」量的是**排队 + 执行 + 负载放大**，
 *     两者不是同一段耗时，21.7ms 并不能推出"门禁里也只该用 21.7ms"。
 *
 *   ⇒ 300 秒这个值**不能靠调小解决**：它覆盖的是机器负载，不是代码。
 *     机器空的时候（独立跑）实测 67/0、67 过 0 挂，全是毫秒级。
 *   ⇒ 真要根治得让那段同步工作分片（把长任务挪出输入事件处理器），
 *     那是**改应用**，不是改测试 —— 超出"定位"范围，此处如实记下不动手。
 *
 * ★★★ v0.129 上面那条结论**被实测推翻了**，根因换成了另一个 —— 读这条之前先看这条。
 *
 *   ## 现象变了：不再是"慢"，是**独立跑也挂**，而且挂点很稳
 *
 *     v0.121 说"机器空的时候独立跑必过（67/0，全是毫秒级）"。
 *     v0.129 实测：**独立跑** 6 次挂 3 次；全量门禁里也挂。
 *     挂点固定在第 62 条 ✓ 之后 —— 也就是最后那段
 *     「锁定某个点后滚轮缩放」的**第 1~3 次 `Input.dispatchMouseEvent` / `mouseWheel`**，
 *     300 秒一次都不回。同一个测试偶发另一种挂法：
 *     「真实滚轮事件打动了 View（0.712 → 0.784）」—— 只推动了 10%，没到 15% 门槛。
 *
 *   ## 决定性证据：卡住的时候，渲染进程是**空的**
 *
 *     做法：把 `send` 临时插桩（一次性探针 `test/_probe-lock.mjs`，用完即删）——
 *     每条命令计时，**超过 5 秒就并发再发一条 `Runtime.evaluate('1+1')`**。
 *     CDP 是流水线式的，同一 socket 上并发两条互不阻塞，所以这个探测成立。
 *
 *       ⏱ [探针] Input.dispatchMouseEvent 已 pending 5.1s ……
 *       ⏱ [探针]   ↳ 并发 Runtime.evaluate 1ms 返回
 *       ✗ 异常：CDP Input.dispatchMouseEvent 300 秒无响应
 *
 *     ⇒ 滚轮那条挂了 300 秒，同会话里问一句 `1+1` **1 毫秒就回**。
 *       **渲染进程的 JS 主线程完全空闲。**
 *
 *   ## 所以 v0.121 那条"应用侧同步工作 × 负载"的结论不成立
 *
 *     若真是我们的 JS 堵死了渲染进程，那条并发 evaluate 必然一起卡住。它 1ms 就回了。
 *     同一次采样里整机 CPU 也只有 9~42%（偶有 73% 的短尖峰）、
 *     可用内存 2.5~4.9 GB —— **不是负载问题**。
 *
 *   ## 现在的定位：阻塞在**浏览器这一侧的手势管线**，不在我们的代码
 *
 *     两条旁证：
 *       ① 失败只发生在 `mouseWheel`，v0.121 探针测过的 `mousePressed/mouseReleased`
 *          至今仍是 1~7 ms。滚轮走的是**手势识别器**（要等合成器确认手势），
 *          点击不走 —— 这是两条不同的路径，v0.121 只测了后者，所以漏了。
 *       ② 单独写探针复刻同一场景（锁定 149 点/616 线，与这里的 142/616 同量级）：
 *          滚轮 12~20 ms 就返回，但 **View 纹丝不动**
 *          （zoom 恒为 0.7123793727382388，五次一模一样）——
 *          即手势**被丢弃了**，"不生效"和"卡死"是同一个病的两种表现。
 *
 *   ## 试过并**已撤销**的修法（记下来是为了别再试一遍）
 *
 *     两个实验，都是加 Chrome 开关，各自跑满 4~6 次统计：
 *       A `--disable-threaded-animation --disable-threaded-scrolling
 *          --disable-checker-imaging`（让 headless 输入变确定）
 *         ⇒ 6 跑 **0 过 6 挂**，比 3/3 的基线更差
 *       B `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
 *          --disable-background-timer-throttling`（关掉后台/遮挡节流；
 *          针对"合成器停摆 ⇒ 手势等不到确认"这个假设）
 *         ⇒ 4 跑 **0 过 4 挂**，与 0/4 的基线持平，**无改善**
 *     两个都已撤销，`git diff` 确认还原干净 —— **不留没证据的开关**。
 *
 *   ## 现在的状态：仍红，且**不是数据改动引入的**
 *
 *     本轮只改了 `scripts/validate.mjs`（判据修正），没碰任何 `.json`、没碰应用代码。
 *     门禁偶发绿、偶发红都出现过（独立跑也 3/6 过）。
 *     ⇒ 这是**已定位到浏览器侧、但还没找到修法**的独立问题，如实记下不动手：
 *       修它要动 ECharts 的 roam 或换成非手势的缩放驱动，属于改应用/改测试策略。
 */
const CDP_TIMEOUT = (method) => (String(method).startsWith('Input.') ? 300000 : 30000);
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  /* CDP 响应不来时 pending 条目永不 settle ⇒ 进程静默挂死（0 字节输出、无退出码）。 */
  setTimeout(() => {
    if (pending.delete(id)) reject(new Error(`CDP ${method} ${CDP_TIMEOUT(method) / 1000} 秒无响应`));
  }, CDP_TIMEOUT(method));
});
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

const probe = () => js(`(() => {
  const ba = window.__ba, st = ba.state, ch = ba.chart();
  const gs = ch.getOption().series[0];
  const all = gs.data || [];
  const nodes = all.map((d) => d.id).filter((id) => !String(id).startsWith('__gen_'));
  const bands = all.filter((d) => String(d.id).startsWith('__gen_')).length;
  const links = gs.links || [];
  const lock = st.clickLock;
  return {
    locked: !!lock,
    depth: lock ? lock.depth : null,
    origin: lock ? lock.origin : null,
    nodes, nNodes: nodes.length, nBands: bands, nLinks: links.length,
    allNodes: st.book.characters.length,
    linkIds: links.map((l) => [l.source, l.target]),
    pos: [...st.pos.entries()].slice(0, 300).map(([k, v]) => k + ':' + v.x.toFixed(6) + ',' + v.y.toFixed(6)).join('|'),
  };
})()`);

const click = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.click(); })()`);
const fill = (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
/** 走真实的解除路径：**「重置」按钮**（v89 起不再是双击空白 —— 双击只复位视野） */
const unlockAll = async () => {
  await js(`(() => { const b = document.getElementById('reset-btn'); if (!b) throw new Error('no reset-btn'); b.click(); })()`);
  await wait(2600);
};
/** 双击空白：只复位视野，不解除锁定（v89） */
const dblBlank = async () => {
  await js(`(() => {
    const zr = window.__ba.chart().getZr();
    zr.handler.dispatch('dblclick', { zrX: 20, zrY: 20, target: null, offsetX: 20, offsetY: 20 });
  })()`).catch(() => {});
  await wait(1800);
};

/* ⚠ 这里**不**做"合成一次画布点击"。
 *
 * 试过了，做不到，而且失败方式很隐蔽：headless 下 CDP 的 Input.dispatchMouseEvent 到不了页面，
 * 只能走 zr.handler.dispatch 造事件；但 graph 系列的节点图元不带 dataIndex，事件映射靠
 * `el.__ecData`，而压缩版把它改名成了 `__ec_inner_N` —— **N 每次运行都不一样**
 * （实测一次是 _1/_2/_4，下一次是 _4/_5/_7），没有稳定可用的字段；
 * findHover 返回的还是 {x,y,topTarget,target} 而不是图元本身。第一版用 findHover 自检，
 * 命中的是 null 却照样"通过"了 —— 那条断言是空的，白绿一场。
 *
 * 所以下面只测 handler 里那两个**函数**的组合（selectCharacter 不建锁 / restoreLock 回填原锁），
 * 事件接线本身留给人工点一次确认。不拿一个测不到的东西充数。 */
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
  for (let i = 0; i < 240; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length>500)`).catch(() => false)) break;
    await wait(100);
  }
  await wait(2500);
  await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`);
  await wait(1800);

  /* ================= ① 两人关系 ================= */
  console.log('\n▶ 两人关系 诸葛亮 → 刘备：图上只剩这条链');
  const baseA = await probe();
  ok(!baseA.locked, '初始没有锁定');
  console.log(`    基线：${baseA.nNodes} 点 + ${baseA.nBands} 个代际图注 / ${baseA.nLinks} 线（全书 ${baseA.allNodes} 人）`);

  await fill('#path-a', '诸葛亮'); await fill('#path-b', '刘备');
  await click('#path-go');
  await wait(2600);
  const path = await probe();
  ok(path.locked && path.origin === 'path', `已锁定（origin=${path.origin}）`);
  ok(path.nNodes === 2, `图上只剩 2 个点（实际 ${path.nNodes}）`);
  ok(path.nBands <= 2, `代际图注只保留真有节点的那几组（${path.nBands} / ${path.nBands} → ${baseA.nBands}）`);
  ok(path.nLinks === 9, `只剩刘备—诸葛亮之间的 9 条线（实际 ${path.nLinks}）`);
  ok(path.nNodes + path.nLinks <= 12, `图元总数 ${baseA.nNodes + baseA.nLinks} → ${path.nNodes + path.nLinks}`);
  ok(path.linkIds.every(([s, t]) =>
    (s === 'zhuge-liang' && t === 'liu-bei') || (s === 'liu-bei' && t === 'zhuge-liang')),
    '每条线的两端都是这两个人（没有混进无关的边）');
  ok(!(await js(`!!document.querySelector('#lock-bar [data-lock-depth]')`)),
    '两人关系锁不显示跳数控件（集合就是那条链）');

  await dblBlank();
  const stillLocked = await probe();
  ok(stillLocked.locked, '双击空白**不再**解除锁定（v89：双击只复位视野）');
  ok(stillLocked.nNodes === path.nNodes && stillLocked.nLinks === path.nLinks,
    `双击之后图还是那条链（${stillLocked.nNodes} / ${stillLocked.nLinks}）`);

  await click('#view-reset-btn');
  await wait(1800);
  const afterViewReset = await probe();
  ok(afterViewReset.locked, '「复位视图」也**不**解除锁定（两个动作都只是"找回视野"）');

  await unlockAll();
  const pathBack = await probe();
  ok(!pathBack.locked, '「重置」才解除锁定');
  ok(pathBack.nNodes === baseA.nNodes && pathBack.nLinks === baseA.nLinks,
    `图完整还原：${pathBack.nNodes} / ${pathBack.nLinks}（基线 ${baseA.nNodes} / ${baseA.nLinks}）`);
  ok(pathBack.pos === baseA.pos, '解除后坐标逐位还原（fitPositions 写回坐标的坑没踩到）');

  /* ================= ② 搜索锁定 ================= */
  console.log('\n▶ 搜索单个人物：只画跟他有关系的点和线');
  const baseB = await probe();          // ← 基线必须在**上锁前一刻**取
  await fill('#search-input', '诸葛亮');
  await click('#search-go');
  await wait(2600);
  const s1 = await probe();
  ok(s1.locked && s1.origin === 'search', `已锁定（origin=${s1.origin}, depth=${s1.depth}）`);
  ok(s1.nodes.includes('zhuge-liang'), '中心人物在图上');
  ok(s1.nNodes > 1 && s1.nNodes < baseB.nNodes,
    `图上只剩 ${s1.nNodes} 个点（上锁前 ${baseB.nNodes}）—— 他 + ${s1.nNodes - 1} 个直接相关的人`);
  ok(s1.nLinks < baseB.nLinks, `线从 ${baseB.nLinks} 降到 ${s1.nLinks}`);
  ok(s1.linkIds.every(([s, t]) => s1.nodes.includes(s) && s1.nodes.includes(t)),
    '每条线的两端都在图上的点集内（没有"看不见但挡路"的边）');
  console.log(`    ${s1.nNodes} 点 / ${s1.nLinks} 线（上锁前 ${baseB.nNodes} / ${baseB.nLinks}）`);

  /* ================= ③ 跳数控件 ================= */
  console.log('\n▶ 跳数 1 → 2 → 3');
  ok(await js(`!!document.querySelector('#lock-bar [data-lock-depth="inc"]')`), '有「＋跳」控件');
  ok(await js(`document.querySelector('#lock-bar [data-lock-depth="dec"]').disabled`), '1 跳时「−跳」禁用（下限就是 1）');
  await click('#lock-bar [data-lock-depth="inc"]'); await wait(2000);
  const s2 = await probe();
  ok(s2.depth === 2, `跳数变成 2（实际 ${s2.depth}）`);
  ok(s2.nNodes >= s1.nNodes, `点数随跳数不减：${s1.nNodes} → ${s2.nNodes}`);
  ok(s2.nNodes < s2.allNodes, `2 跳仍在全书范围内（${s2.nNodes} < ${s2.allNodes}）`);
  ok(s2.linkIds.every(([a, b]) => s2.nodes.includes(a) && s2.nodes.includes(b)), '2 跳时每条线的两端也都画出来了');
  await click('#lock-bar [data-lock-depth="inc"]'); await wait(2000);
  const s3 = await probe();
  ok(s3.depth === 3, `能到 3 跳（实际 ${s3.depth}）`);
  ok(await js(`document.querySelector('#lock-bar [data-lock-depth="inc"]').disabled`), '3 跳时「＋跳」禁用（上限就是 3）');
  await click('#lock-bar [data-lock-depth="dec"]'); await wait(1600);
  await click('#lock-bar [data-lock-depth="dec"]'); await wait(2000);
  const s1b = await probe();
  ok(s1b.depth === 1 && s1b.nNodes === s1.nNodes, `「−跳」退回 1 跳且点数复原（${s1b.depth} 跳 / ${s1b.nNodes} 点）`);

  /* ================= ④ 代价对比（信息性，不做断言） ================= */
  console.log('\n▶ 代价：锁定后重画一次 option 要多久');
  const cost = await js(`(() => {
    const ba = window.__ba, ch = ba.chart();
    const bench = (fn, n) => { fn(); const a = performance.now(); for (let i = 0; i < n; i++) fn(); return +((performance.now() - a) / n).toFixed(1); };
    const locked = bench(() => ch.setOption(ba._buildOption(), { notMerge: true }), 15);
    const gs = ch.getOption().series[0];
    const nNodes = (gs.data || []).length, nLinks = (gs.links || []).length;
    // 解锁后再量一次全图的
    const lock = ba.state.clickLock;
    ba.state.clickLock = null;
    const open = bench(() => ch.setOption(ba._buildOption(), { notMerge: true }), 15);
    const g2 = ch.getOption().series[0];
    const oNodes = (g2.data || []).length, oLinks = (g2.links || []).length;
    ba.state.clickLock = lock;
    ch.setOption(ba._buildOption(), { notMerge: true });
    return { locked, open, nNodes, nLinks, oNodes, oLinks };
  })()`);
  console.log(`    锁定时  ${cost.nNodes} 点 / ${cost.nLinks} 线 → 重画 ${cost.locked} ms`);
  console.log(`    未锁定  ${cost.oNodes} 点 / ${cost.oLinks} 线 → 重画 ${cost.open} ms`);
  console.log(`    ⇒ ${(cost.open / cost.locked).toFixed(1)}×（setOption 的成本对图元数是线性的）`);

  /* ================= ⑤ 解除还原 ================= */
  console.log('\n▶ 解除锁定：完整还原');
  await unlockAll();
  const back = await probe();
  ok(!back.locked, '锁定已解除');
  ok(back.nNodes === baseB.nNodes && back.nLinks === baseB.nLinks,
    `图完整还原：${back.nNodes} 点 / ${back.nLinks} 线（上锁前 ${baseB.nNodes} / ${baseB.nLinks}）`);
  ok(back.pos === baseB.pos, '坐标逐位还原');

  /* ================= ⑥ 两种锁互斥：换锁时清掉对方的残留输入 ================= */
  /* 用户报的现象：搜完一个人没点清除就去查两人关系，界面自相矛盾 ——
   * 搜索框里还写着上一个人，锁条上写的是两人关系；这时在搜索框敲回车还会静悄悄锁回去。
   * 状态本身不会"撞车"（两条路径都先 unlockClick 再重建），坏掉的是**输入框的残留**。 */
  console.log('\n▶ 两种锁互斥：换锁时把另一种查询的残留清掉');

  await fill('#search-input', '曹操');
  await click('#search-go');
  await wait(2600);
  ok(await js(`document.getElementById('search-input').value.trim() === '曹操'`), '搜索框里是「曹操」');

  await fill('#path-a', '刘备'); await fill('#path-b', '诸葛亮');
  await click('#path-go');
  await wait(2800);
  const cross1 = await probe();
  const sv = await js(`document.getElementById('search-input').value`);
  ok(cross1.locked && cross1.origin === 'path', `锁换成了两人关系（origin=${cross1.origin}）`);
  ok(sv === '', `搜索框里的「曹操」已被清掉（现在读作 "${sv}"）—— 否则界面自相矛盾、回车还会锁回去`);
  ok(await js(`document.getElementById('path-a').value.trim() === '刘备'`), '两人关系的输入保持不动');

  await fill('#search-input', '关羽');
  await click('#search-go');
  await wait(2800);
  const cross2 = await probe();
  const pa = await js(`document.getElementById('path-a').value`);
  const pb = await js(`document.getElementById('path-b').value`);
  ok(cross2.locked && cross2.origin === 'search', `锁换成了搜索（origin=${cross2.origin}）`);
  ok(pa === '' && pb === '', `两人关系输入也被清掉（path-a="${pa}" path-b="${pb}"）`);

  // 同一把锁重复查询不该被自己的清理误伤
  await fill('#search-input', '张飞');
  await click('#search-go');
  await wait(2600);
  ok(await js(`document.getElementById('search-input').value.trim() === '张飞'`), '又搜一个：输入框保持「张飞」');

  // 锁条上要写清解除路径，且不能再提「复位视图」
  const hint = await js(`(() => { const e = document.querySelector('#lock-bar .lock-hint'); return e ? e.textContent.trim() : ''; })()`);
  ok(hint.includes('重置') && hint.includes('清除'), `锁条给出了解除路径：「${hint}」`);
  ok(!hint.includes('复位视图'), '锁条不再把「复位视图」说成解除路径');

  await unlockAll();
  const fin = await probe();
  ok(!fin.locked, '最后「重置」能解除');

  /* ================= ③ v93：从图外导航进画布，一样要建锁 =================
   *
   * 用户 v93 指出：锁定只在「搜单个人物」和「两人关系查询」两条路上有，
   * 而右栏人名、右栏关系列表、事件卡／事件轴芯片、阵营图例、地点筛选
   * 这些"从图外把画布带到某个主题"的入口全都不锁 —— 点完就能在图上随便点走，语境丢了。
   *
   * 口径（用户拍板）：**从图外导航进来的一律建锁；图上点击不建锁**（那是"在图里接着走"）。 */
  console.log('\n▶ v93 右栏人名（data-goto）：从图外导航进画布 ⇒ 建锁');
  // 先在右栏里渲染出一个人名链接（人物档案的关系列表里就有），点它
  await fill('#search-input', '诸葛亮');
  await click('#search-go');
  await wait(2600);
  await unlockAll();
  const beforeGoto = await probe();
  ok(!beforeGoto.locked, '起点：没有锁（好让下面这条断言有意义）');

  const gotoClicked = await js(`(() => {
    // 找一个真实渲染出来的右栏人名链接，而不是直接调 selectCharacter
    window.__ba.selectCharacter('liu-bei');            // 先把右栏渲染成刘备的档案
    const el = [...document.querySelectorAll('#panel [data-goto]')].find((b) => b.dataset.goto && b.dataset.goto !== 'liu-bei');
    if (!el) return null;
    const id = el.dataset.goto;
    el.click();
    return id;
  })()`);
  await wait(2600);
  const afterGoto = await probe();
  ok(!!gotoClicked, `右栏人名链接存在并可点（点了 ${gotoClicked}）`);
  ok(afterGoto.locked, `点右栏人名后建锁了（origin=${afterGoto.origin}）`);
  ok(afterGoto.origin === 'search', '用的是搜索那套锁（人物 + 可调跳数）');
  ok(afterGoto.nNodes > 1 && afterGoto.nNodes < beforeGoto.nNodes,
    `图收敛到这一片的邻域：${beforeGoto.nNodes} → ${afterGoto.nNodes} 点`);
  ok(await js(`!!document.querySelector('#lock-bar .lock-depth')`), '跳数控件也在（和搜索一致）');
  // 图上每个点的两端关系都必须在点集内 —— 不许有"看不见但挡路"的边（v89 的老坑）
  ok(await js(`(() => {
    const st = window.__ba.state, l = st.clickLock;
    // 没有锁时直接判失败，别抛异常 —— 抛异常会把后面所有断言都吞掉，
    // 报错信息还停在测试脚本里，看不出是哪一条行为不对。
    if (!l) return false;
    // edges 是 Set，没有 .every（第一版就栽在这，报 l.edges.every is not a function）
    return [...l.edges].every((k) => { const [a, b] = String(k).split('|'); return l.nodes.has(a) && l.nodes.has(b); });
  })()`), '锁定集合里的每条线两端都在点集内');

  console.log('\n▶ v93 图上点节点／点线**不**建锁（要在图里接着走关系链）');
  await unlockAll();
  const beforeCanvas = await probe();
  const canvasRes = await js(`(() => {
    const ch = window.__ba.chart();
    return ch.getOption().series[0].data.find((d) => !String(d.id).startsWith('__gen_') && d.id !== 'cao-cao')?.id || null;
  })()`);
  await js(`window.__ba.graphClick('node', { id: 'cao-cao' })`);
  await wait(1500);
  const afterChar = await probe();
  ok(!!canvasRes, `图上找得到可点的节点（${canvasRes}）`);
  ok(!afterChar.locked, '图上选人**不**建锁（口径：图外导航才锁）');
  ok(await js(`document.getElementById('lock-bar').hidden === true`), '锁条也没出现');
  // ⚠ 故意**不**断言"点数不变"：高亮一个枢纽人物（曹操 261 条关系）会把先前折叠的
  // 次要人物也点亮（isCharHidden 开头就是 hlNodes.has(c.id) ⇒ 不折叠），
  // 实测 326 → 371 是既有行为，与锁定无关。第一版把它当回归，断言本身就是错的。

  // 已锁着时在图内点人：原样保留那把锁，不换成"这个人"的新锁。
  // 驱动的是**真实的** click 处理器（onGraphClick），不是它的副本。
  await js(`window.__ba.selectRelation('cao-cao', 'liu-bei')`);
  await wait(2000);
  const relBefore = await js(`window.__ba.lockInfo()`);
  await js(`window.__ba.graphClick('node', { id: 'liu-bei' })`);
  await wait(1500);
  const relAfter = await js(`window.__ba.lockInfo()`);
  ok(relBefore && relBefore.origin === 'rel', `起点：关系锁已上（${relBefore && relBefore.label}）`);
  ok(relAfter && relAfter.origin === relBefore.origin && relAfter.label === relBefore.label,
    `在图内点人，锁原样保留（仍是「${relAfter && relAfter.label}」/ ${relAfter && relAfter.origin}），没有换成以新点的人为准的锁`);
  ok(relAfter && relBefore && relAfter.nNodes === relBefore.nNodes,
    `锁定集合也没被这次点击改动（${relBefore && relBefore.nNodes} → ${relAfter && relAfter.nNodes} 点）`);

  // 反向：锁着时点**锁外**的人要被拦住（这条以前只有 toast，没有断言）
  const blocked = await js(`(() => {
    const st = window.__ba.state, l = st.clickLock;
    if (!l) return { skipped: true };                 // 没有锁就没得"拦"，判失败而不是抛异常
    const outsider = st.book.characters.map((c) => c.id).find((id) => !l.nodes.has(id));
    if (!outsider) return { skipped: true };
    window.__ba.graphClick('node', { id: outsider });
    return { outsider, stillLocked: !!st.clickLock, label: st.clickLock && st.clickLock.label };
  })()`);
  await wait(800);
  ok(!blocked.skipped && blocked.outsider && blocked.stillLocked && relBefore && blocked.label === relBefore.label,
    blocked.skipped ? '（跳过：没有锁可拦）' : `锁着时点锁外的人（${blocked.outsider}）被拦住，锁没变`);

  console.log('\n▶ v93 关系／事件／阵营 导航建锁的范围');
  // 关系：两端各自扩一跳（不是就锁两个人 —— 那样图会塌成两点，
  // 关系卡上"在图上点另一个节点可以顺着关系链继续走"就自相矛盾了）
  await js(`window.__ba.selectRelation('cao-cao', 'liu-bei')`);
  await wait(2000);
  const relLock = await probe();
  ok(relLock.locked && relLock.origin === 'rel', `点关系进画布建锁（origin=${relLock.origin}）`);
  ok(relLock.nNodes > 2, `关系锁是「两端 + 各自一跳」，不是就两个人：${relLock.nNodes} 点`);
  ok(await js(`!!document.querySelector('#lock-bar .lock-depth')`), '关系锁也有跳数控件');

  // 事件：在场的人各自扩一跳
  await unlockAll();
  const evId = await js(`(() => {
    const st = window.__ba.state;
    // 挑一个人多的事件，免得"锁成 1~2 个人"这种退化情况被误当成正常
    const ev = [...st.book.events].filter((e) => (e.chars || []).length >= 4 && !(e.chars || []).some((c) => st.charLockedId && st.charLockedId(c)))[0];
    return ev ? ev.id : null;
  })()`);
  await js(`(() => { const el = document.querySelector('#timeline .event-chip[data-event="' + CSS.escape(${JSON.stringify('')}) + '"]'); })()`).catch(() => {});
  if (evId) {
    await js(`window.__ba.selectEventForTest(${JSON.stringify(evId)})`).catch(async () => {
      // 没有测试入口就点真实芯片
      await js(`(() => { const el = document.querySelector('#timeline .event-chip[data-event="' + CSS.escape(${JSON.stringify(evId)}) + '"]'); if (!el) throw new Error('no chip'); el.click(); })()`);
    });
    await wait(2000);
    const evLock = await probe();
    ok(evLock.locked && evLock.origin === 'event', `点事件卡建锁（origin=${evLock.origin}）`);
    ok(evLock.nNodes > 4, `事件锁是「在场的人 + 各自一跳」：${evLock.nNodes} 点`);
  } else {
    ok(false, '找一个在场 ≥4 人的事件失败');
  }

  console.log('\n▶ v93 换锁时清残留：按**被丢掉那把锁**的来源清，不是按新锁');
  // 这是 v93 顺手修掉的一个潜伏 bug：原来按新锁来源决定清哪个框，
  // 只有两种来源时恰好成立，加了 rel/event/faction/place 之后就不成立了 ——
  // 从搜索锁切到关系锁会去清两人关系的输入框，而真正该清的是搜索框里残留的人名。
  await unlockAll();
  await fill('#search-input', '曹操');
  await click('#search-go');
  await wait(2600);
  await js(`window.__ba.selectRelation('cao-cao', 'liu-bei')`);
  await wait(2000);
  const cleared = await js(`document.getElementById('search-input').value`);
  ok(cleared.trim() === '',
    `搜索锁 → 关系锁：搜索框里残留的「曹操」被清掉（现在读作 "${cleared}"）—— 不然敲一下回车就锁回曹操`);

  await unlockAll();

  /* ================= ⑦ v0.97 锁定某个点后滚轮缩放，画布不许被复位 =================
   *
   * 用户报的现象：锁定单个人物（= 锁定某个点）之后，滚轮一缩放，画布就被"复位"了。
   *
   * 病根不在滚轮，在 **setOption**：原来的 buildOption 写的是
   *     ...(opts.keepView ? {} : { zoom, center })
   * 也就是"保留视野"靠**不把 zoom/center 写进 option**，赌 ECharts 会自己保住。
   * 那个赌注输了 —— ECharts 的 View 坐标系每次 setOption 都会按**当前绘制集合**
   * 重新自动适配；不传 center/zoom 它就重算。锁定时绘制集合变小，小图被重新塞满画布，
   * 于是用户的缩放被丢掉（实测 zoom 3 → 0.229、center [0,0] → [0,-11]）。
   *
   * 本节用**真实滚轮事件**（CDP Input.dispatchMouseEvent / mouseWheel）驱动，
   * 因为派发合成 WheelEvent 是不行的：zrender 不认非可信事件，测试会"假绿"。 */
  console.log('\n▶ v0.97 锁定某个点后滚轮缩放：画布不许被复位');
  await unlockAll();
  await fill('#search-input', '曹操');
  await click('#search-go');
  await wait(2800);
  const zoomLock = await probe();
  ok(zoomLock.locked && zoomLock.origin === 'search',
    `锁定单个人物（${zoomLock.nNodes} 点 / ${zoomLock.nLinks} 线 —— 绘制集合比全图小）`);

  const readView = () => js(`(() => {
    const ch = window.__ba.chart();
    const cs = ch.getModel().getSeriesByIndex(0).coordinateSystem;
    return { zoom: cs.getZoom(), center: cs.getCenter().map((v) => Math.round(v)) };
  })()`);

  const view0 = await readView();
  const cbox = await js(`(() => {
    const r = document.getElementById('graph').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const each = [];
  for (let i = 0; i < 5; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cbox.x, y: cbox.y, deltaX: 0, deltaY: -120 });
    await wait(220);
    each.push({ v: await readView(), s: await js(`window.__ba.state.zoom`) });
  }
  console.log(`    逐格：${each.map((e, i) => `${i + 1}: View ${e.v.zoom.toFixed(3)} / state ${(+e.s).toFixed(3)}`).join('　')}`);
  await wait(1300);          // 等 graphroam 里那个 200ms 的标签定时器跑完（复位就发生在它里面）
  const view1 = await readView();
  const wheelMoved = Math.abs(view1.zoom - view0.zoom) / view0.zoom > 0.15;
  ok(wheelMoved, `真实滚轮事件打动了 View（${view0.zoom.toFixed(3)} → ${view1.zoom.toFixed(3)}，center ${JSON.stringify(view0.center)} → ${JSON.stringify(view1.center)}）`);

  // 决定性断言：标签刷新那种"不动绘制集合的 setOption"不许把视野冲掉。
  // 没有修复时这里是 3 → 0.229（掉了 92%）。
  const kept = await js(`(() => {
    const ba = window.__ba, ch = ba.chart();
    const cs = () => ch.getModel().getSeriesByIndex(0).coordinateSystem;
    const before = { zoom: cs().getZoom(), center: cs().getCenter().map((v) => Math.round(v)) };
    ch.setOption(ba._buildOption({ keepView: true }), { notMerge: true });
    const after = { zoom: cs().getZoom(), center: cs().getCenter().map((v) => Math.round(v)) };
    return { before, after };
  })()`);
  const drift = Math.abs(kept.after.zoom - kept.before.zoom) / (Math.abs(kept.before.zoom) || 1);
  const driftC = Math.max(...kept.after.center.map((v, i) => Math.abs(v - kept.before.center[i])));
  console.log(`    setOption 前 ${kept.before.zoom.toFixed(3)} @ ${JSON.stringify(kept.before.center)} → 后 ${kept.after.zoom.toFixed(3)} @ ${JSON.stringify(kept.after.center)}`);
  ok(drift < 0.02, `keepView 的 setOption 不再把缩放冲掉（漂移 ${(drift * 100).toFixed(1)}%，门槛 2%）`);
  ok(driftC <= 1, `中心也不再跑掉（漂移 ${driftC}px）`);

  // 锁着的时候 option 必须一直带着 zoom/center —— 少了它们，ECharts 就会自己重新适配（＝复位）
  const optView = await js(`(() => {
    const s = window.__ba._buildOption({ keepView: true }).series[0];
    return { zoom: s.zoom, center: s.center ? s.center.slice() : null };
  })()`);
  ok(typeof optView.zoom === 'number', `keepView 建 option 时仍然带着 zoom（${optView.zoom}）`);
  ok(Array.isArray(optView.center), `也带着 center（${JSON.stringify(optView.center)}）`);

  await unlockAll();
} catch (e) {
  failed++;
  console.error('  ✗ 异常：' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
} finally {
  try { ws.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  releaseProfile(profile);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`锁定只显示相关　通过：${passed}  失败：${failed}`);
process.exit(failed > 0 ? 1 : 0);