import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// v92：守住「布局本身是完全可复现的」这条性质。
//
// 用户问"为什么每次打开人物所在的位置都不一样，是不是每次都重新生成了一遍"。
// 实测结论：**不是随机重算** —— 两次独立冷启动（全新 profile / localStorage），
// 三个视图 871 个坐标逐位相同，代码里也没有任何 Math.random()。
// 变的只是**视野**：布局按视口长宽比适配，视口一变（窗口大小、页面滚动、右栏开合）
// 同一个人落在屏幕的哪儿就不同。
//
// ��条性质很关键：正因为布局可复现，**才不需要**把坐标持久化下来
// （Gephi「保存布局」、Cytoscape session 那套）。所以它必须被守住 ——
// 哪天有人往布局里塞了一个 Math.random() 或者依赖了帧数，这里就会红。
//
// 「自由」视图单列：它的力导向模拟是**按帧跑**的（d3 的文档明确说帧驱动只适合交互渲染，
// 要可复现必须 stop() + 固定 tick 次数），冻结时刻落在哪一步取决于帧率 —— 实测两次冷启动
// 相同视口下也能对上，但**换视口就对不上**，所以这里只断言同视口。
import { setTimeout as sleep } from 'node:timers/promises';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* ⚠ 每次冷启动必须用**自己的** CDP 端口。
 *
 * 踩过的坑：一开始 A、B 两次冷启动共用一个端口，而 A 的浏览器是 spawn 完 → 用完 → kill，
 * 中间只 sleep 800ms。headless Edge 退出没那么快，端口还没释放，于是 B 的
 * `/json/list` 拿到的是**A 那只还没死透的浏览器**的 target —— 测试以为在量 B，其实在量 A。
 *
 * 症状极有迷惑性：布局本身完全可复现（同输入纯函数），但 fit.s 每次都稳定地差一个值
 * （实测 A 恒为 0.20678、B 恒为 0.22478），而且连抓三遍都一样 ⇒ 不是采样撞上异步 refit，
 * 是压根连错了浏览器。定位这个问题花了好几轮，改端口后 5 连过。 */
let cdpSeq = 0;
/** 钉死的画布高度（见 coldStart 里那段注释）。用 !important，inline style 会被 applyViewHeight 覆盖。 */
const PIN_H = 560;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.log('  (跳过) 找不到 Edge/Chrome'); process.exit(0); }

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
/* 端口让系统分配（listen(0)），不要写死。
 *
 * 踩过的坑：写死 19271，而这个测试一次要跑一分多钟（两次冷启动 × 三个视图，
 * 其中「自由」每次要等 20s）。一旦有上一轮残留进程还占着端口，
 * 后面 6 次跑全部 EADDRINUSE 直接崩掉 —— 而只看断言行的检查脚本会把崩溃
 * 读成"没有失败行 = 通过"，于是一片假绿。
 * 崩溃必须自己变成红灯：显式处理 error 事件。 */
server.on('error', (e) => { console.error('静态服务器起不来：' + e.message); process.exit(1); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

/** 一次独立冷启动：全新 profile（⇒ 全新 localStorage）→ 切视图 → 抓坐标 */
async function coldStart(label, views) {
  const CDP_PORT = 19300 + (cdpSeq++) * 2;      // 每次冷启动独占一个端口，见上面那段注释
  sweepStaleProfiles();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-det-'));
  const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
  const cdpUrl = () => new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
      let b = ''; r.on('data', (d) => { b += d; });
      r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
  let url = null;
  for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await sleep(250); } }
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

  const out = {};
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
    for (let i = 0; i < 300; i++) {
      if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length>500)`).catch(() => false)) break;
      await sleep(100);
    }
    await sleep(2500);
    await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`).catch(() => {});
    await sleep(1500);

    /* 画布高度必须钉死 —— 用**样式表的 !important**，不能用 inline style。
     *
     * 为什么这是个必须解决的问题：fitPositions 拿 #graph 的容器尺寸去套数据包围盒
     * 算缩放（app.js:1340），而 applyViewHeight() 会按"图上方还剩多少可视高度"
     * 重写这个高度（app.js:1468）。图上方那些文字（人数提示、图注…）的行数会随视图变，
     * 于是同一个窗口、同一个视图，两次冷启动也可能差几十像素
     * （实测「自由」1129×531 vs 1129×565、「分组·横」也会撞上）。
     * 容器差 34px ⇒ fit.s 从 0.2248 变 0.2068 ⇒ 整张图等比缩放 ⇒ 坐标全不一样。
     *
     * 为什么不能用 inline style：onResize 里会再调一次 applyViewHeight()，
     * 它写的是 el.style.height —— **inline style 会被它覆盖掉**，于是我钉的高度
     * 又被改回 531/565，还引发 ResizeObserver 来回抖（这正是第一次尝试失败的原因，
     * 而且 fit.s 两个值会在多次运行间**对调**，极具迷惑性）。
     * 样式表里的 !important 优先级高于 inline 非 important 声明，applyViewHeight 改不动它。
     *
     * 这只是测试夹具，不改产品行为：钉死高度 = 把"视口差异"这个无关变量从实验里剔除，
     * 好让这一项只回答"布局本身可不可复现"。 */
    await js(`(() => {
      let s = document.getElementById('ba-test-pin');
      if (!s) { s = document.createElement('style'); s.id = 'ba-test-pin'; document.head.appendChild(s); }
      s.textContent = '#graph { height: ${PIN_H}px !important; }';
    })()`);
    await sleep(600);

    for (const v of views) {
      await js(`document.querySelector('[data-view="${v}"]').click()`);
      await sleep(v === 'force' ? 20000 : 5000);      // force 的冻结定时器是 12s（>400 人）
      /* 钉完高度后 ResizeObserver 会异步触发一次 onResize → fitPositions() 整体重缩放。
       * 在它落地之前抓坐标，量到的是"改到一半"的中间态。
       * 判据两道都要：高度真的到位了（!important 生效）+ 连续两次坐标签名相同。
       * 光看签名不够 —— 高度还没稳的时候签名也可能连续两次一样。 */
      /* v93：必须等布局**稳定下来**再抓，否则量到的是"改到一半"的中间态。
       *
       * 起因是一次假红：两边 fit.s 分别是 0.2068 和 0.2248（同��输入、同求解器，
       * 纯函数不可能差），差的其实是 setView 里 applyViewHeight() 改了 #graph 的高度，
       * ResizeObserver 随后异步触发 onResize → fitPositions() 又整体缩放了一次 ——
       * 这次缩放落在"抓坐标"之前还是之后，取决于帧的时机。
       * 那个异步 refit 本身是对的（窗口变了就该重新适配），只是**采样**不能撞上它。
       * 于是这里连抓三遍，拿到连续两次相同的结果才算数。 */
      /* 采样必须等布局**稳定**下来。
       *
       * 钉完高度后 ResizeObserver 会异步触发一次 onResize → fitPositions() 整体重缩放。
       * 如果在它落地之前抓坐标，量到的是"改到一半"的中间态。
       * 判据用「高度真的到位了 + 连续两次坐标签名相同」两道，光看签名不够 ——
       * 高度还没变的时候签名也可能连续两次一样。 */
      let prev = null;
      for (let t = 0; t < 40; t++) {
        const s = await js(`(() => { const st = window.__ba.state, e = document.getElementById('graph');
          let sum = 0; for (const p of st.pos.values()) sum += p.x * 7.13 + p.y * 3.71;
          return { sig: String(Math.round(sum * 1e4)), h: e.clientHeight }; })()`);
        if (s.h === PIN_H && s.sig === prev) break;
        prev = s.sig;
        await sleep(400);
      }
      out[v] = await js(`(() => { const st = window.__ba.state; const m = {};
        for (const [id, p] of st.pos) m[id] = [p.x, p.y];
        const el = document.getElementById('graph');
        return { pos: m, n: st.pos.size, frozen: st.frozen, view: st.view,
                 layout: st.chart.getOption().series[0].layout,
                 fitS: st.fit && st.fit.s, zoom: st.zoom, forceInput: st.forceInput || null,
                 W: el.clientWidth, H: el.clientHeight }; })()`);
      console.log(`    ${label} ${v.padEnd(6)} 节点=${out[v].n} 画布=${out[v].W}×${out[v].H} view=${out[v].view} series.layout=${out[v].layout} fit.s=${String(out[v].fitS).slice(0, 12)}`
        + (out[v].forceInput ? ` 力导向输入 n=${out[v].forceInput.n} links=${out[v].forceInput.links}` : ''));
    }
  } finally {
    try { ws.close(); } catch { }
    try { proc.kill(); } catch { }
    releaseProfile(profile);
    await sleep(800);
  }
  return out;
}

const diff = (a, b) => {
  const ids = Object.keys(a).filter((k) => b[k]);
  let same = 0, maxD = 0;
  for (const id of ids) {
    const d = Math.hypot(a[id][0] - b[id][0], a[id][1] - b[id][1]);
    if (d < 1e-9) same++; else maxD = Math.max(maxD, d);
  }
  return { same, total: ids.length, maxD };
};
/** 对不上时把两边的环境一起打出来：光说"最大差 20"没法定位是布局不同还是画布不同 */
const why = (label, x) => console.log(`      ${label}: 画布=${x.W}×${x.H} view=${x.view} series.layout=${x.layout} fit.s=${String(x.fitS).slice(0, 14)} zoom=${x.zoom}`);

try {
  const views = ['gen-v', 'gen-h', 'force'];
  console.log('▶ ① 两次独立冷启动（全新 profile/localStorage，同视口）坐标应逐位相同');
  const a = await coldStart('A', views);
  const b = await coldStart('B', views);
  for (const v of views) {
    const d = diff(a[v].pos, b[v].pos);
    /* ⚠ 必须同时断言"确实量到了节点"，不能只比坐标。
     *
     * 起因：把确定性力导向回退成 ECharts 那套之后，本文件连跑 4 次**全绿** ——
     * 而回退明明让布局不可复现了。查下来是那次回退让 `state.pos` 一直是空的
     * （去掉 forceLayoutVisible 的同时 60ms 的 freezeTimer 也早被我删了，于是没人再填坐标），
     * 于是比较的是 0 个节点 vs 0 个节点：same(0) === total(0) ⇒ 通过。
     *
     * **拿空集合比较会假绿。** 这和"崩在开头被只看断言行的脚本读成通过"是同一族错误：
     * 断言没有被真正执行，却报告了"没有失败"。
     */
    ok(d.total > 300, `${v.padEnd(6)} 确实量到了节点（${d.total} 个，低于 300 说明布局压根没生成）`);
    ok(d.same === d.total,
      `${v.padEnd(6)} ${d.same}/${d.total} 个节点坐标逐位相同${d.maxD > 0 ? `（最大差 ${d.maxD.toFixed(2)}）` : ''}`);
    if (d.same !== d.total) {
      why('A', a[v]); why('B', b[v]);
      if (v === 'force') {
        // 求解器是纯函数：同输入必然同输出。所以只要两次的**输入**不一样，
        // 输出就不一样 —— 该查的是"进了力导向的节点集合为什么变了"，不是求解器。
        const fa = a[v].forceInput, fb = b[v].forceInput;
        if (fa && fb && (fa.n !== fb.n || fa.links !== fb.links)) {
          console.error(`      ⚠ 两次的力导向**输入**就不同：n ${fa.n} vs ${fb.n}，links ${fa.links} vs ${fb.links}`);
        }
      }
    }
  }

  console.log('\n▶ ② 「自由」视图的结果不能取决于你之前去过哪些视图');
  console.log('    （这是"每次打开人物位置都不一样"的直接来源：以前大书会拿当前布局坐标当力导向的热启动）');
  const PIN = `(() => {
      let s = document.getElementById('ba-test-pin');
      if (!s) { s = document.createElement('style'); s.id = 'ba-test-pin'; document.head.appendChild(s); }
      s.textContent = '#graph { height: ${PIN_H}px !important; }';
    })()`;
  const hist = await (async () => {
    const CDP_PORT = 19300 + (cdpSeq++) * 2;
    sweepStaleProfiles();
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-hist-'));
    const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
    const cdpUrl = () => new Promise((res, rej) => {
      http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
        let s = ''; r.on('data', (d) => { s += d; });
        r.on('end', () => { try { res(JSON.parse(s).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
      }).on('error', rej);
    });
    let url = null;
    for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await sleep(250); } }
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); } };
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 60000); });
    const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const grab = () => js(`(() => { const st = window.__ba.state; const m = {};
      for (const [id, p] of st.pos) m[id] = [p.x, p.y]; return m; })()`);
    const boot = async () => {
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
      for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length>500)`).catch(() => false)) break; await sleep(100); }
      await sleep(2500);
      await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`).catch(() => {});
      await sleep(1500);
    };
    const out = {};
    try {
      await send('Page.enable'); await send('Runtime.enable');
      const PIN2 = PIN;
      // 甲：先逛「分组·纵」→「分组·横」，最后才进「自由」
      await boot();
      await js(`document.querySelector('[data-view="gen-v"]').click()`); await sleep(5000);
      await js(`document.querySelector('[data-view="gen-h"]').click()`); await sleep(5000);
      await js(`document.querySelector('[data-view="force"]').click()`); await sleep(4000);
      await js(PIN2); await sleep(1200);          // 同上：钉死画布再抓，否则量到的是适配差异
      out.viaHistory = await grab();
      // 乙：重新打开，一进来就直接进「自由」
      await boot();
      await js(`document.querySelector('[data-view="force"]').click()`); await sleep(4000);
      await js(PIN2); await sleep(1200);
      out.direct = await grab();
    } finally {
      try { ws.close(); } catch { }
      try { proc.kill(); } catch { }
      releaseProfile(profile);
    }
    return out;
  })();
  const hd = diff(hist.viaHistory, hist.direct);
  ok(hd.total > 300 && hd.same === hd.total,
    `逛过两个视图再进「自由」vs 直接进「自由」：${hd.same}/${hd.total} 相同${hd.maxD > 0 ? `（最大差 ${hd.maxD.toFixed(2)}）` : ''}`);

  console.log('\n▶ ③ 布局代码里不许有随机数');
  const src = readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  // relaxPositions / buildGenerationPositions / fillMissingPositions 三段都不该出现随机
  const bodies = ['function relaxPositions', 'function buildGenerationPositions', 'function fillMissingPositions']
    .map((k) => { const i = src.indexOf(k); if (i === -1) return ''; return src.slice(i, src.indexOf('\n  function ', i + 10)); });
  const withRandom = bodies.filter((x) => x && /Math\.random/.test(x));
  ok(withRandom.length === 0, `relaxPositions / buildGenerationPositions / fillMissingPositions 里没有 Math.random（发现 ${withRandom.length} 处）`);

  console.log('\n▶ ④ 视野记忆：改过 zoom/center 后重开，会回到同一处');
  console.log('    （roam / render-scale 两个测试已间接覆盖"点人拉得回来"，这里只确认"重开回到原处"这条链路）');
  const vm = await (async () => {
    const CDP_PORT = 19300 + (cdpSeq++) * 2;
    sweepStaleProfiles();
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-vm-'));
    const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
    const PIN = `(() => {
      let s = document.getElementById('ba-test-pin');
      if (!s) { s = document.createElement('style'); s.id = 'ba-test-pin'; document.head.appendChild(s); }
      s.textContent = '#graph { height: ${PIN_H}px !important; }';
    })()`;
    const cdpUrl = () => new Promise((res, rej) => {
      http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
        let s = ''; r.on('data', (d) => { s += d; });
        r.on('end', () => { try { res(JSON.parse(s).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
      }).on('error', rej);
    });
    let url = null;
    for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await sleep(250); } }
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); } };
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 40000); });
    const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const out = {};
    try {
      await send('Page.enable'); await send('Runtime.enable');
      const boot = async (opts = {}) => {
        await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
        for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length>500)`).catch(() => false)) break; await sleep(100); }
        await sleep(2500);
        /* 首屏那几轮"稳定期"的 resize 必须在 pendingView 有效期内发生，才是它要挡的那些。
         * ⚠ 时机很要紧：pendingView 只活 3 秒，而 boot() 全程要 4 秒 ——
         * 在 boot 结束之后再补 resize，那已经超窗了，复位是**设计内的正确行为**，
         * 拿它当断言只会得到一条假红（我就这么错判过一次，以为应用坏了）。
         * 所以要在这 2.5s 之内、图刚起来时就派发。 */
        if (opts.resizeWhileSettling) {
          await js(`window.dispatchEvent(new Event('resize'))`);
          await sleep(400);
        }
        await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`).catch(() => {});
        await sleep(1500);
        /* ⚠ 这里**不能**钉画布高度（v93 踩过）。
         *
         * 钉高度＝改 #graph 的计算尺寸 → 真的触发一次 resize → onResize → resetRoam()。
         * 而复位是承重的（见 roam ④：去掉它，那条测试从 5/6 掉到 2/6），
         * 于是刚恢复好的"上次视野"被复位成默认 —— 断言读到的就是 zoom 1 / center [0,0]。
         * 诊断靠 test/_vmprobe.mjs 逐段打点才看出来：恢复其实成功了（载入后 zoom=2.2），
         * 是测试自己后面那一钉把它抹掉的。
         *
         * ① 那段要钉高度，是为了**跨浏览器比较坐标**时排除容器尺寸这个变量；
         * ④ 只比较"重开后有没有回到同一处"，两次都是同一个窗口，本来就不需要钉。 */
        return js(`(() => { const st = window.__ba.state;
          return { zoom: +st.zoom.toFixed(4), vc: st.viewCenter.map((v) => Math.round(v)),
                   mem: localStorage.getItem('ba-viewmem:' + st.book.slug),
                   h: document.getElementById('graph').clientHeight }; })()`);
      };
      out.first = await boot();
      // 手动调一个明显的视野：放大 2.2 倍并挪到一边
      await js(`window.__ba.applyZoom(2.2, [-120, 40])`);
      await sleep(400);
      out.moved = await js(`(() => { const st = window.__ba.state;
        return { zoom: +st.zoom.toFixed(4), vc: st.viewCenter.map((v) => Math.round(v)),
                 mem: localStorage.getItem('ba-viewmem:' + st.book.slug) }; })()`);
      out.reopen = await boot({ resizeWhileSettling: true });
      /* 恢复视野之后、首屏还在稳定期（pendingView 有效期内）时来一次 resize，视野必须还在。
       *
       * 这条差点被我弄丢：④ 原本为了固定画布高度给 #graph 写了行内 style.height，
       * 那会真的触发 resize、把刚恢复的视野抹掉（断言读到的就是 zoom 1 / center [0,0]）。
       * 我当时判定"那是测试自己捣乱"就把钉高度删了 —— 结果 resize 路径**再也不被触发**，
       * 而 pendingView（专门为"扛过随后那几轮 resize"而存在的机制）就彻底没人测：
       * 回退 pvLive 之后本文件一项都不红。**删掉捣乱的动作 ≠ 覆盖自动还在。**
       *
       * 现在由 boot(resizeWhileSettling) 在图刚起来时就派发一次，走 onResize → resetRoam()，
       * pendingView 在有效期内会让 resetRoam 用回刚恢复好的视野。 */
    } finally {
      try { ws.close(); } catch { }
      try { proc.kill(); } catch { }
      releaseProfile(profile);
    }
    return out;
  })();
  console.log(`    刚打开： zoom=${vm.first.zoom} center=${JSON.stringify(vm.first.vc)} 记忆=${vm.first.mem ? '有' : '无'}`);
  console.log(`    调到：   zoom=${vm.moved.zoom} center=${JSON.stringify(vm.moved.vc)} 记忆=${vm.moved.mem ? '有' : '无'}`);
  console.log(`    重开后： zoom=${vm.reopen.zoom} center=${JSON.stringify(vm.reopen.vc)}`);
  ok(!!vm.moved.mem, '调过视野之后 localStorage 里留下了记忆');
  ok(vm.reopen.zoom === vm.moved.zoom && JSON.stringify(vm.reopen.vc) === JSON.stringify(vm.moved.vc),
    `重开后回到同一处（zoom ${vm.reopen.zoom} / center ${JSON.stringify(vm.reopen.vc)}）`);
  ok(vm.reopen.zoom === vm.moved.zoom && JSON.stringify(vm.reopen.vc) === JSON.stringify(vm.moved.vc),
    `首屏稳定期内来过一次 resize，视野仍然没被抹掉（zoom ${vm.reopen.zoom}）—— pendingView 的职责`);

  console.log(`\n${failed ? '✗' : '✓'} 布局可复现性与视野记忆：${passed} 通过，${failed} 失败`);
} catch (e) { failed++; console.error('异常：' + e.message); }
finally { try { server.close(); } catch { } }
// 没跑到最后一步就崩了（端口占用、CDP 起不来之类）也必须算失败，
// 否则外面只看断言行的脚本会把"崩在开头"读成"一条都没红 = 通过"。
if (passed + failed === 0) { console.error('✗ 一条断言都没跑到（中途崩了？）'); process.exit(1); }
process.exit(failed ? 1 : 0);